/**
 * Алгоритм YIN (De Cheveigné & Kawahara, 2002) для высокоточного определения
 * фундаментальной частоты гитарной струны во временной области.
 *
 * Преимущество перед FFT: устойчив к мощным вторым/третьим обертонам басовых струн (E2, D2, A2).
 */

export interface YinDetectionResult {
  /** Найденная частота в Гц или null, если сигнал шумовой / непериодический */
  frequency: number | null;
  /** Достоверность (вероятность периодичности 0..1) */
  probability: number;
  /** Среднеквадратичная амплитуда сигнала (RMS) */
  rms: number;
}

/**
 * Вычисляет среднеквадратичный уровень громкости (RMS) аудио-буфера
 */
export function calculateRMS(buffer: Float32Array): number {
  let sumSquares = 0;
  const len = buffer.length;
  for (let i = 0; i < len; i++) {
    const val = buffer[i];
    sumSquares += val * val;
  }
  return Math.sqrt(sumSquares / len);
}

// Переиспользуемый буфер YIN для исключения 60 аллокаций Float32Array в секунду (Zero-GC на смартфонах)
let reusableYinBuffer = new Float32Array(2048);

function getYinScratchBuffer(size: number): Float32Array {
  if (reusableYinBuffer.length < size) {
    reusableYinBuffer = new Float32Array(size);
  }
  return reusableYinBuffer;
}

/**
 * Определяет основную частоту сигнала методом YIN с параболической интерполяцией.
 *
 * @param buffer Временной буфер из AnalyserNode.getFloatTimeDomainData (рекомендуется 4096 сэмплов)
 * @param sampleRate Частота дискретизации AudioContext (обычно 44100 или 48000 Гц)
 * @param rmsThreshold Порог шумоподавления (Noise Gate)
 * @param yinThreshold Порог асимметрии минимума CMND (по умолчанию 0.14)
 */
export function detectPitchYIN(
  buffer: Float32Array,
  sampleRate: number,
  rmsThreshold = 0.008,
  yinThreshold = 0.14
): YinDetectionResult {
  const rms = calculateRMS(buffer);
  if (rms < rmsThreshold) {
    return { frequency: null, probability: 0, rms };
  }

  // Рабочий диапазон гитарных частот: от 28 Гц (ниже B0/C1) до 1100 Гц (выше C6)
  const minFreq = 28;
  const maxFreq = 1100;

  const halfBufferSize = Math.floor(buffer.length / 2);
  const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
  const tauMax = Math.min(halfBufferSize, Math.ceil(sampleRate / minFreq));

  if (tauMax <= tauMin) {
    return { frequency: null, probability: 0, rms };
  }

  const yinBuffer = getYinScratchBuffer(tauMax);

  // Шаг 1 & 2: Разностная функция d(tau) = sum((x[i] - x[i + tau])^2)
  // Используем шаг 2 на длинных буферах 4096 сэмплов (экономит 50% CPU на мобильных без потери точности)
  const sampleStep = halfBufferSize >= 2048 ? 2 : 1;
  for (let tau = 1; tau < tauMax; tau++) {
    let deltaSum = 0;
    for (let i = 0; i < halfBufferSize; i += sampleStep) {
      const diff = buffer[i] - buffer[i + tau];
      deltaSum += diff * diff;
    }
    yinBuffer[tau] = deltaSum;
  }

  // Шаг 3: Кумулятивная нормированная разностная функция d'(tau) (CMND)
  yinBuffer[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < tauMax; tau++) {
    runningSum += yinBuffer[tau];
    if (runningSum === 0) {
      yinBuffer[tau] = 1;
    } else {
      yinBuffer[tau] = (yinBuffer[tau] * tau) / runningSum;
    }
  }

  // Шаг 4: Абсолютный порог — ищем первый локальный минимум ниже yinThreshold
  let tauEstimate = -1;
  let probability = 0;

  for (let tau = tauMin; tau < tauMax; tau++) {
    if (yinBuffer[tau] < yinThreshold) {
      while (tau + 1 < tauMax && yinBuffer[tau + 1] < yinBuffer[tau]) {
        tau++;
      }
      tauEstimate = tau;
      probability = 1 - yinBuffer[tauEstimate];
      break;
    }
  }

  // Если ни одно значение не опустилось ниже порога, ищем глобальный минимум, если он достаточно глубокий
  if (tauEstimate === -1) {
    let minVal = 1;
    let minTau = -1;
    for (let tau = tauMin; tau < tauMax; tau++) {
      if (yinBuffer[tau] < minVal) {
        minVal = yinBuffer[tau];
        minTau = tau;
      }
    }
    if (minTau !== -1 && minVal < 0.32) {
      tauEstimate = minTau;
      probability = 1 - minVal;
    } else {
      return { frequency: null, probability: 0, rms };
    }
  }

  // Шаг 5: Параболическая интерполяция для суб-сэмпловой точности
  let betterTau = tauEstimate;
  if (tauEstimate > 1 && tauEstimate < tauMax - 1) {
    const s0 = yinBuffer[tauEstimate - 1];
    const s1 = yinBuffer[tauEstimate];
    const s2 = yinBuffer[tauEstimate + 1];
    const denominator = 2 * (2 * s1 - s2 - s0);
    if (Math.abs(denominator) > 1e-7) {
      const adjustment = (s2 - s0) / denominator;
      if (Math.abs(adjustment) < 1) {
        betterTau = tauEstimate + adjustment;
      }
    }
  }

  const frequency = sampleRate / betterTau;
  if (frequency < minFreq || frequency > maxFreq || !Number.isFinite(frequency)) {
    return { frequency: null, probability: 0, rms };
  }

  return {
    frequency,
    probability: Math.max(0, Math.min(1, probability)),
    rms,
  };
}

/**
 * Комбинированный фильтр сглаживания частоты:
 * 1) Медианный фильтр по последним 5 замерам (отсекает случайные выбросы гармоник)
 * 2) Экспоненциальное скользящее среднее (EMA) для плавного хода индикатора
 */
export class PitchSmoother {
  private windowSize: number;
  private alpha: number;
  private buffer: number[] = [];
  private smoothedFreq: number | null = null;

  constructor(windowSize = 5, alpha = 0.35) {
    this.windowSize = windowSize;
    this.alpha = alpha;
  }

  public push(frequency: number): number {
    // Если новая частота отличается от текущей более чем на 2 полутона (~12%),
    // сбрасываем историю, чтобы тюнер мгновенно переключился на другую струну
    if (
      this.smoothedFreq !== null &&
      Math.abs(frequency - this.smoothedFreq) / this.smoothedFreq > 0.12
    ) {
      this.buffer = [frequency];
      this.smoothedFreq = frequency;
      return frequency;
    }

    this.buffer.push(frequency);
    if (this.buffer.length > this.windowSize) {
      this.buffer.shift();
    }

    // Вычисляем медиану текущего окна
    const sorted = [...this.buffer].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 !== 0
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;

    // Применяем EMA поверх медианы
    if (this.smoothedFreq === null) {
      this.smoothedFreq = median;
    } else {
      this.smoothedFreq =
        this.alpha * median + (1 - this.alpha) * this.smoothedFreq;
    }

    return this.smoothedFreq;
  }

  public reset(): void {
    this.buffer = [];
    this.smoothedFreq = null;
  }
}
