import {
  TabNote,
  computeNoteTargetMidi,
  midiToFrequency,
  midiToLabel,
} from '../types/tabs';
import { ensureAudioContextResumed } from './audioContextManager';
import { PitchSmoother, calculateRMS, detectPitchYIN } from './yinPitchDetector';

export type PracticeDifficulty = 'arcade' | 'medium' | 'pro';

interface DifficultyProfile {
  /** Допуск высоты YIN в центах */
  centsTolerance: number;
  /** Минимальная уверенность YIN */
  yinMinProb: number;
  /** Порог уверенности YIN для мгновенного 1-кадрового засчёта */
  instantHitProb: number;
  /** Макс. отклонение в центах для мгновенного 1-кадрового засчёта */
  instantHitCents: number;
  /** Октавная помощь (±1200 ct) на всех струнах */
  allowOctaveAllStrings: boolean;
  /** Множитель к Noise Gate для прохода в оценку */
  noiseGateMultiplier: number;
  /** Минимальный прирост Goertzel над снимком входа (дБ) для одиночной ноты */
  goertzelSingleRiseDb: number;
  /** Допустимый спад Goertzel относительно общего RMS (дБ) для одиночной ноты */
  goertzelSingleRelDb: number;
  /** Граница частоты (Гц), ниже которой Goertzel учитывает 2-ю гармонику 2·f0 */
  goertzelHarmonicCutoffHz: number;
  /** Требовать ли проверку шумовых плеч ±16 Гц */
  useShoulderCheck: boolean;
  /** Запас над плечами ±16 Гц (одиночная / аккорд) */
  shoulderMarginSingle: number;
  shoulderMarginChord: number;
  /** Параметры аккордов */
  chordWindowMs: number;
  chordRelDb: number;
  chordDyadRelDb: number;
  chordRequiredRatio: number;
  chordDyadNeeded: number;
  chordMinNeeded: number;
  /** Разрешать ли засчёт аккорда по главной ноте через YIN (Аркадный) */
  arcadeMainNoteChord: boolean;
  /** Тайминги защитных окон переходов (мс) */
  guardNewMs: number;
  guardRepeatMs: number;
  guardLegatoMs: number;
  guardSlapMs: number;
  /** Прирост в полосе для повторного щипка той же ноты (дБ) */
  repeatReAttackRiseDb: number;
}

const DIFFICULTY_PROFILES: Record<PracticeDifficulty, DifficultyProfile> = {
  arcade: {
    centsTolerance: 80,
    yinMinProb: 0.48,
    instantHitProb: 0.48,
    instantHitCents: 80,
    allowOctaveAllStrings: true,
    noiseGateMultiplier: 0.75,
    goertzelSingleRiseDb: 4.5,
    goertzelSingleRelDb: -25.5,
    goertzelHarmonicCutoffHz: 340,
    useShoulderCheck: false,
    shoulderMarginSingle: 2.0,
    shoulderMarginChord: 1.5,
    chordWindowMs: 320,
    chordRelDb: -25.5,
    chordDyadRelDb: -23.5,
    chordRequiredRatio: 0.35,
    chordDyadNeeded: 1,
    chordMinNeeded: 1,
    arcadeMainNoteChord: true,
    guardNewMs: 120,
    guardRepeatMs: 180,
    guardLegatoMs: 85,
    guardSlapMs: 160,
    repeatReAttackRiseDb: 4.2,
  },
  medium: {
    centsTolerance: 58,
    yinMinProb: 0.56,
    instantHitProb: 0.8,
    instantHitCents: 34,
    allowOctaveAllStrings: false,
    noiseGateMultiplier: 0.9,
    goertzelSingleRiseDb: 5.5,
    goertzelSingleRelDb: -23.5,
    goertzelHarmonicCutoffHz: 260,
    useShoulderCheck: true,
    shoulderMarginSingle: 3.4,
    shoulderMarginChord: 2.4,
    chordWindowMs: 280,
    chordRelDb: -23.5,
    chordDyadRelDb: -21.0,
    chordRequiredRatio: 0.5,
    chordDyadNeeded: 2,
    chordMinNeeded: 2,
    arcadeMainNoteChord: false,
    guardNewMs: 130,
    guardRepeatMs: 200,
    guardLegatoMs: 95,
    guardSlapMs: 180,
    repeatReAttackRiseDb: 5.0,
  },
  pro: {
    centsTolerance: 35,
    yinMinProb: 0.65,
    instantHitProb: 1.1,
    instantHitCents: 0,
    allowOctaveAllStrings: false,
    noiseGateMultiplier: 1.0,
    goertzelSingleRiseDb: 7.0,
    goertzelSingleRelDb: -20.5,
    goertzelHarmonicCutoffHz: 155,
    useShoulderCheck: true,
    shoulderMarginSingle: 4.5,
    shoulderMarginChord: 3.6,
    chordWindowMs: 200,
    chordRelDb: -20.5,
    chordDyadRelDb: -18.5,
    chordRequiredRatio: 0.75,
    chordDyadNeeded: 2,
    chordMinNeeded: 2,
    arcadeMainNoteChord: false,
    guardNewMs: 150,
    guardRepeatMs: 220,
    guardLegatoMs: 100,
    guardSlapMs: 200,
    repeatReAttackRiseDb: 6.0,
  },
};

export interface PracticeEvaluationResult {
  /** Текущая громкость микрофона (RMS 0..1) */
  rms: number;
  /** Нормированный импульс щелчка/слапа (0..1) для живого индикатора калибровки */
  slapImpulse: number;
  /** Зафиксирован ли перкуссионный щелчок на этом кадре */
  slapTriggered: boolean;
  /** Зафиксирована ли свежая атака (onset) на этом кадре */
  isOnset: boolean;
  /** Ждет ли движок нового щипка (для повторяющихся нот или в защитном окне) */
  waitingForAttack: boolean;
  /** Откалибровался ли авто-детектор щелчка под громкость гитары */
  autoSlapCalibrated: boolean;
  /** Распознана ли целевая нота / аккорд / слап / смешанная доля */
  matched: boolean;
  /** Зафиксирована ли явно ошибочная нота (для подсветки ошибки) */
  isWrongPitch: boolean;
  /** Обнаруженная нота в текстовом виде (например, "E2", "E2 G3...", "Щелчок (X)") */
  detectedLabel: string | null;
  /** Отклонение в центах (для одиночных нот) */
  cents: number | null;
  /** Тип проверки */
  checkKind: 'single' | 'chord' | 'slap' | 'mixed' | 'rest';
}

export interface TargetBeatExpectation {
  notes: TabNote[];
  openStringMidi: number[];
  currentCapo: number;
  /** Если true — режим «Шаг за шагом» (умная защита от проскока долей) */
  requireFreshOnset: boolean;
}

export interface BeatTransitionOptions {
  /** Мгновенный старт (первая доля, ручной выбор или пропуск — без защитного окна) */
  isImmediate?: boolean;
  /** Следующая доля содержит легато/слайд (переход без нового щипка) */
  isLegato?: boolean;
  /** Следующая доля — чистый щелчок X */
  isSlapOnly?: boolean;
  /** MIDI-ноты предыдущей доли */
  previousMidis?: number[];
  /** MIDI-ноты новой целевой доли */
  nextMidis?: number[];
}

// Предвычисленное окно Ханна для быстрого Goertzel-анализа без аллокаций (2048 децимированных точек = 85 мс)
const GOERTZEL_SAMPLES = 2048;
const HANN_WINDOW = new Float32Array(GOERTZEL_SAMPLES);
for (let i = 0; i < GOERTZEL_SAMPLES; i++) {
  HANN_WINDOW[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (GOERTZEL_SAMPLES - 1)));
}

/**
 * Гибридный DSP-движок проверки гитарной игры (сбалансированный режим):
 * 1) Канал 1 — Тюнерный YIN + PitchSmoother (та же точность и мягкость, что в Тюнере, порог 0.0075, ±48 ct)
 * 2) Канал 2 — Точный частотный анализ Goertzel (f0 / 2·f0) с опорой на снимок входа в долю:
 *    - ловит тихие мелодические ноты на фоне гудящего баса (дельта >= +7 dB над baseline)
 *    - распознает аккорды без самоподавления соседних нот + окно перебора 220 мс
 * 3) Умная защита от проскока по типу перехода (новая нота / повтор ноты / легато / щелчок)
 * 4) Двухбазовое автоопределение щелчка (X): само подстраивается под шум комнаты и громкость гитары
 */
export class PracticeDspEngine {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;

  private timeDomainBuffer: Float32Array<ArrayBuffer> | null = null;
  private freqDbBuffer: Float32Array<ArrayBuffer> | null = null;

  private isRunning = false;
  private rafId: number | null = null;

  // Калибруемые пороги (по умолчанию 0.0075 — точно как в Тюнере!)
  private noiseGateThreshold = 0.0075;
  private difficulty: PracticeDifficulty = 'medium';
  private autoSlapEnabled = true;
  private manualSlapSensitivity = 0.72;

  // Сглаживатель высоты как в Тюнере + скользящее голосование 2 из 3 кадров
  private pitchSmoother = new PitchSmoother(4, 0.42);
  private pitchVoteRing: [boolean, boolean, boolean] = [false, false, false];
  private pitchVoteIdx = 0;

  // Двухбазовая автокалибровка щелчка (X)
  private ambientPeakEma = 0.008;
  private ambientHfDbEma = -84;
  private guitarPeakRef = 0.085;
  private guitarNoteSamples = 0;

  // Адаптивные трекеры огибающей
  private prevShortRms = 0;
  private emaShortRms = 0.004;
  private emaShortPeak = 0.012;
  private emaMidHfDb = -82;
  private emaThumpDb = -75;
  private lastOnsetTimestamp = 0;
  private lastSlapTimestamp = 0;

  // Умный автомат переходов (защита от проскока без блокировки новых нот!)
  private transitionGuardUntil = 0;
  private awaitingRepeatReAttack = false;
  private hasTakenEntrySnapshot = false;
  private entryBaselineDb = new Map<number, number>();
  private repeatMinBandDb = Infinity;
  private repeatMinShortRms = Infinity;
  private previousBeatMidis: number[] = [];

  // Скользящее окно накопления аккорда (220 мс — работает и для боя, и для фингерстайл-перебора)
  private chordNoteHeardAt = new Map<number, number>();
  private chordHasFreshRise = false;

  // Скользящее окно смешанной доли (320 мс: X + нота/аккорд)
  private mixedSlapHeardAt = 0;
  private mixedPitchHeardAt = 0;
  private mixedPitchLabel: string | null = null;

  private getTargetFn: (() => TargetBeatExpectation | null) | null = null;
  private onResultFn: ((res: PracticeEvaluationResult) => void) | null = null;

  public setNoiseGateThreshold(threshold: number): void {
    this.noiseGateThreshold = Math.max(0.003, Math.min(0.05, threshold));
  }

  public getNoiseGateThreshold(): number {
    return this.noiseGateThreshold;
  }

  public setAutoSlapEnabled(enabled: boolean): void {
    this.autoSlapEnabled = enabled;
  }

  public isAutoSlapEnabled(): boolean {
    return this.autoSlapEnabled;
  }

  public setDifficulty(mode: PracticeDifficulty): void {
    this.difficulty = mode;
    this.pitchVoteRing = [false, false, false];
    this.pitchVoteIdx = 0;
    this.chordNoteHeardAt.clear();
  }

  public getDifficulty(): PracticeDifficulty {
    return this.difficulty;
  }

  public setSlapSensitivity(sensitivity: number): void {
    this.manualSlapSensitivity = Math.max(0.05, Math.min(1.0, sensitivity));
  }

  public getSlapSensitivity(): number {
    return this.manualSlapSensitivity;
  }

  public configure(
    getTarget: () => TargetBeatExpectation | null,
    onResult: (res: PracticeEvaluationResult) => void
  ): void {
    this.getTargetFn = getTarget;
    this.onResultFn = onResult;
  }

  /**
   * Настраивает защиту перехода под конкретный тип следующей доли
   */
  public notifyBeatChanged(options: BeatTransitionOptions): void {
    const now = performance.now();
    const prevMidis = options.previousMidis ?? [];
    const nextMidis = options.nextMidis ?? [];

    this.previousBeatMidis = prevMidis;
    this.pitchVoteRing = [false, false, false];
    this.pitchVoteIdx = 0;
    this.hasTakenEntrySnapshot = false;
    this.entryBaselineDb.clear();
    this.repeatMinBandDb = Infinity;
    this.repeatMinShortRms = Infinity;
    this.chordNoteHeardAt.clear();
    this.chordHasFreshRise = false;
    this.mixedSlapHeardAt = 0;
    this.mixedPitchHeardAt = 0;
    this.mixedPitchLabel = null;

    if (options.isImmediate) {
      this.transitionGuardUntil = 0;
      this.awaitingRepeatReAttack = false;
      this.pitchSmoother.reset();
      return;
    }

    const profile = DIFFICULTY_PROFILES[this.difficulty];

    if (options.isSlapOnly) {
      // Чистый щелчок X: защитное окно, чтобы прошлый щипок не засчитал X
      this.transitionGuardUntil = now + profile.guardSlapMs;
      this.awaitingRepeatReAttack = false;
      return;
    }

    if (options.isLegato) {
      // Легато (hammer-on / pull-off / slide): короткое окно, новый щипок не нужен
      this.transitionGuardUntil = now + profile.guardLegatoMs;
      this.awaitingRepeatReAttack = false;
      return;
    }

    // Проверяем, пересекаются ли высоты новой доли с предыдущей
    const sharesAnyPitch =
      nextMidis.length > 0 &&
      prevMidis.length > 0 &&
      nextMidis.some((m) => prevMidis.includes(m));

    if (sharesAnyPitch) {
      // Повтор той же ноты или аккорда с общими нотами -> окно + ждем реальный новый щипок
      this.transitionGuardUntil = now + profile.guardRepeatMs;
      this.awaitingRepeatReAttack = true;
    } else {
      // Новая другая нота или другой аккорд -> короткое окно, без блокировки общим RMS!
      this.transitionGuardUntil = now + profile.guardNewMs;
      this.awaitingRepeatReAttack = false;
    }
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;

    const ctx = await ensureAudioContextResumed();
    this.audioContext = ctx;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: false,
      },
    });

    this.mediaStream = stream;
    this.sourceNode = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.05;

    this.sourceNode.connect(this.analyser);
    this.timeDomainBuffer = new Float32Array(this.analyser.fftSize);
    this.freqDbBuffer = new Float32Array(this.analyser.frequencyBinCount);

    this.pitchSmoother.reset();
    this.pitchVoteRing = [false, false, false];
    this.pitchVoteIdx = 0;
    this.prevShortRms = 0;
    this.emaShortRms = 0.004;
    this.emaShortPeak = 0.012;
    this.emaMidHfDb = -82;
    this.emaThumpDb = -75;
    this.ambientPeakEma = 0.008;
    this.ambientHfDbEma = -84;
    this.lastOnsetTimestamp = 0;
    this.lastSlapTimestamp = 0;
    this.transitionGuardUntil = 0;
    this.awaitingRepeatReAttack = false;
    this.hasTakenEntrySnapshot = false;
    this.entryBaselineDb.clear();
    this.chordNoteHeardAt.clear();
    this.chordHasFreshRise = false;
    this.mixedSlapHeardAt = 0;
    this.mixedPitchHeardAt = 0;
    this.mixedPitchLabel = null;
    this.isRunning = true;

    this.loop();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // ignore
      }
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
    this.analyser = null;
    this.timeDomainBuffer = null;
    this.freqDbBuffer = null;
    this.pitchSmoother.reset();
  }

  private loop = (): void => {
    if (
      !this.isRunning ||
      !this.analyser ||
      !this.timeDomainBuffer ||
      !this.freqDbBuffer ||
      !this.audioContext
    ) {
      return;
    }

    this.analyser.getFloatTimeDomainData(this.timeDomainBuffer);
    this.analyser.getFloatFrequencyData(this.freqDbBuffer);

    const sampleRate = this.audioContext.sampleRate;
    const now = performance.now();

    // 1. Суб-кадровый анализ свежих 768 сэмплов (~16 мс)
    const buf = this.timeDomainBuffer;
    const len = buf.length;
    const shortStart = Math.max(0, len - 768);
    let shortSumSq = 0;
    let shortPeak = 0;
    let zeroCrossings = 0;
    let prevSign = buf[shortStart] >= 0;

    for (let i = shortStart; i < len; i++) {
      const v = buf[i];
      const av = v < 0 ? -v : v;
      shortSumSq += v * v;
      if (av > shortPeak) shortPeak = av;
      const sign = v >= 0;
      if (sign !== prevSign) {
        zeroCrossings++;
        prevSign = sign;
      }
    }

    const shortLen = len - shortStart;
    const shortRms = Math.sqrt(shortSumSq / shortLen);
    const fullRms = calculateRMS(buf);
    const effectiveRms = Math.max(fullRms, shortRms);
    const rmsDb = 20 * Math.log10(fullRms + 1e-9);

    const crestFactor = shortPeak / (shortRms + 1e-5);
    const zcr = zeroCrossings / shortLen;

    const midHfDb = this.computeBandEnergyDb(sampleRate, 750, 5200);
    const thumpDb = this.computeBandEnergyDb(sampleRate, 80, 260);

    const midHfJump = midHfDb - this.emaMidHfDb;
    const thumpJump = thumpDb - this.emaThumpDb;
    const peakJumpRatio = shortPeak / Math.max(0.006, this.emaShortPeak);

    // 2. Тюнерный YIN запускаем один раз за кадр (служит одновременно для нот,
    //    опорной ноты аккорда, автокалибровки громкости гитары и фильтра ложных щелчков)
    const profile = DIFFICULTY_PROFILES[this.difficulty];
    const effectiveGate = this.noiseGateThreshold * profile.noiseGateMultiplier;
    const yin =
      effectiveRms >= effectiveGate * 0.85
        ? detectPitchYIN(
            buf,
            sampleRate,
            effectiveGate * 0.85,
            this.difficulty === 'arcade' ? 0.2 : 0.16
          )
        : { frequency: null, probability: 0, rms: fullRms };

    let smoothedFreq: number | null = null;
    if (yin.frequency !== null && yin.probability >= profile.yinMinProb) {
      smoothedFreq = this.pitchSmoother.push(yin.frequency);
      // Автоматически учим типичную громкость вашей гитары при обычных нотах
      if (yin.probability > 0.7 && shortPeak > this.noiseGateThreshold * 2.0) {
        const clampedPeak = Math.min(0.45, shortPeak);
        this.guitarPeakRef =
          this.guitarNoteSamples < 6
            ? this.guitarPeakRef * 0.65 + clampedPeak * 0.35
            : this.guitarPeakRef * 0.96 + clampedPeak * 0.04;
        this.guitarNoteSamples++;
      }
    } else if (effectiveRms < effectiveGate * 0.85) {
      this.pitchSmoother.reset();
      // В паузах мягко подстраиваем уровень шума комнаты
      this.ambientPeakEma = this.ambientPeakEma * 0.96 + shortPeak * 0.04;
      this.ambientHfDbEma = this.ambientHfDbEma * 0.96 + midHfDb * 0.04;
    }

    // 3. Детектор атаки (Onset)
    const rmsDelta = shortRms - this.prevShortRms;
    const isSharpRise =
      effectiveRms > this.noiseGateThreshold * 1.1 &&
      (rmsDelta > Math.max(0.0045, this.emaShortRms * 0.45) ||
        shortRms > this.emaShortRms * 1.5 ||
        peakJumpRatio > 1.85);

    let isOnset = false;
    if (isSharpRise && now - this.lastOnsetTimestamp > 90) {
      isOnset = true;
      this.lastOnsetTimestamp = now;
    }

    // 4. Детектор щелчка (X): Авторежим (двухбазовый) или Ручной режим
    const { slapImpulse, slapTriggered } = this.detectSlap(
      shortPeak,
      crestFactor,
      zcr,
      peakJumpRatio,
      midHfDb,
      midHfJump,
      thumpJump,
      isOnset,
      yin.probability,
      now
    );

    // Плавное обновление скользящих базовых уровней
    const baselineAlpha = slapTriggered || isOnset ? 0.04 : 0.16;
    this.prevShortRms = shortRms;
    this.emaShortRms = this.emaShortRms * (1 - baselineAlpha) + shortRms * baselineAlpha;
    this.emaShortPeak = this.emaShortPeak * (1 - baselineAlpha) + shortPeak * baselineAlpha;
    this.emaMidHfDb = this.emaMidHfDb * (1 - baselineAlpha) + midHfDb * baselineAlpha;
    this.emaThumpDb = this.emaThumpDb * (1 - baselineAlpha) + thumpDb * baselineAlpha;

    const target = this.getTargetFn?.();
    if (!target || target.notes.length === 0) {
      this.onResultFn?.({
        rms: effectiveRms,
        slapImpulse,
        slapTriggered,
        isOnset,
        waitingForAttack: false,
        autoSlapCalibrated: this.guitarNoteSamples >= 3,
        matched: false,
        isWrongPitch: false,
        detectedLabel: slapTriggered ? 'Щелчок (X)' : null,
        cents: null,
        checkKind: 'rest',
      });
      this.rafId = requestAnimationFrame(this.loop);
      return;
    }

    const result = this.evaluateFrame(
      target,
      effectiveRms,
      shortRms,
      rmsDb,
      slapImpulse,
      slapTriggered,
      isOnset,
      yin,
      smoothedFreq,
      sampleRate,
      now
    );
    this.onResultFn?.(result);

    this.rafId = requestAnimationFrame(this.loop);
  };

  /**
   * Автоматическое (или ручное) определение перкуссионного щелчка (X) с фильтром от обычных нот
   */
  private detectSlap(
    shortPeak: number,
    crestFactor: number,
    zcr: number,
    peakJumpRatio: number,
    midHfDb: number,
    midHfJump: number,
    thumpJump: number,
    isOnset: boolean,
    yinProbability: number,
    now: number
  ): { slapImpulse: number; slapTriggered: boolean } {
    let minPeakThreshold: number;
    let minPeakRatio: number;
    let minCrest: number;
    let minSpectralJumpDb: number;

    if (this.autoSlapEnabled) {
      // Двухбазовая автокалибровка: держим порог оптимально между шумом комнаты и громкостью вашей гитары
      const roomFloorPeak = Math.max(this.ambientPeakEma * 2.8, this.noiseGateThreshold * 2.1);
      const guitarScaledPeak = this.guitarPeakRef * 0.24;
      minPeakThreshold = Math.max(0.017, Math.min(0.085, Math.max(roomFloorPeak, guitarScaledPeak)));
      minPeakRatio = 1.62;
      minCrest = 2.52;
      minSpectralJumpDb = 5.4;
    } else {
      const s = this.manualSlapSensitivity;
      minPeakThreshold = Math.max(
        this.noiseGateThreshold * (2.6 - s * 1.35),
        0.016 + (1 - s) * 0.065
      );
      minPeakRatio = 2.4 - s * 0.95;
      minCrest = 3.5 - s * 1.15;
      minSpectralJumpDb = 10.5 - s * 6.0;
    }

    const hasAmplitudePunch = shortPeak >= minPeakThreshold;
    const hfAboveRoom = midHfDb > this.ambientHfDbEma + 5.5;
    const hasTransientShape =
      peakJumpRatio >= minPeakRatio &&
      (crestFactor >= minCrest ||
        (hfAboveRoom && midHfJump >= minSpectralJumpDb) ||
        thumpJump >= minSpectralJumpDb + 1.5);
    const hasBroadbandClick =
      hasAmplitudePunch &&
      hfAboveRoom &&
      midHfJump >= minSpectralJumpDb * 1.2 &&
      (isOnset || zcr > 0.045);

    // Фильтр от ложного срабатывания на обычном громком щипке чистой струны:
    // Если YIN видит очень чистую тональную волну (prob > 0.74) и при этом нет мощного
    // широкополосного ВЧ-щелчка по ладам (>= +9.5 dB), то это обычная нота, а не слап!
    const isClearlyPureNote =
      yinProbability > 0.74 && midHfJump < 9.5 && crestFactor < 3.4;

    const ampScore = Math.min(1, shortPeak / Math.max(0.02, minPeakThreshold * 1.45));
    const fluxScore = Math.min(
      1,
      Math.max(
        0,
        Math.max(midHfJump / Math.max(4, minSpectralJumpDb), (crestFactor - 1.6) / 2.2)
      )
    );
    const slapImpulse = Math.min(1, ampScore * 0.55 + fluxScore * 0.45);

    let slapTriggered = false;
    if (
      hasAmplitudePunch &&
      (hasTransientShape || hasBroadbandClick) &&
      !isClearlyPureNote &&
      now - this.lastSlapTimestamp > 130
    ) {
      slapTriggered = true;
      this.lastSlapTimestamp = now;
    }

    return { slapImpulse, slapTriggered };
  }

  private evaluateFrame(
    target: TargetBeatExpectation,
    rms: number,
    shortRms: number,
    rmsDb: number,
    slapImpulse: number,
    slapTriggered: boolean,
    isOnset: boolean,
    yin: { frequency: number | null; probability: number; rms: number },
    smoothedFreq: number | null,
    sampleRate: number,
    now: number
  ): PracticeEvaluationResult {
    const autoCalibrated = this.guitarNoteSamples >= 3;
    const hasSlap = target.notes.some(
      (n) => n.technique === 'slap' || n.fret < 0
    );
    const hasHarmonic = target.notes.some((n) => n.technique === 'harmonic');

    const targetMidis = target.notes
      .map((n) =>
        computeNoteTargetMidi(n, target.openStringMidi, target.currentCapo)
      )
      .filter((m): m is number => m !== null)
      .sort((a, b) => a - b);

    const checkKind: PracticeEvaluationResult['checkKind'] =
      hasSlap && targetMidis.length === 0
        ? 'slap'
        : hasSlap && targetMidis.length > 0
        ? 'mixed'
        : targetMidis.length > 1
        ? 'chord'
        : targetMidis.length === 1
        ? 'single'
        : 'rest';

    if (checkKind === 'rest') {
      return {
        rms,
        slapImpulse,
        slapTriggered,
        isOnset,
        waitingForAttack: false,
        autoSlapCalibrated: autoCalibrated,
        matched: false,
        isWrongPitch: false,
        detectedLabel: null,
        cents: null,
        checkKind: 'rest',
      };
    }

    // 1. Защитное окно перехода в режиме «Шаг за шагом»
    if (target.requireFreshOnset && now < this.transitionGuardUntil) {
      return {
        rms,
        slapImpulse,
        slapTriggered: false,
        isOnset: false,
        waitingForAttack: true,
        autoSlapCalibrated: autoCalibrated,
        matched: false,
        isWrongPitch: false,
        detectedLabel: null,
        cents: null,
        checkKind,
      };
    }

    // 2. Снимок базовых Goertzel-уровней целевых частот в первый кадр после защитного окна
    if (targetMidis.length > 0 && !this.hasTakenEntrySnapshot) {
      this.entryBaselineDb.clear();
      for (const midi of targetMidis) {
        const db = this.computeMidiGoertzelDb(midi, sampleRate);
        this.entryBaselineDb.set(midi, db);
      }
      this.repeatMinBandDb =
        targetMidis.length > 0
          ? Math.max(...targetMidis.map((m) => this.entryBaselineDb.get(m) ?? -90))
          : -90;
      this.repeatMinShortRms = shortRms;
      this.hasTakenEntrySnapshot = true;
    }

    const profile = DIFFICULTY_PROFILES[this.difficulty];
    const effectiveGate = this.noiseGateThreshold * profile.noiseGateMultiplier;

    // 3. Для ПОВТОРЯЮЩЕЙСЯ ноты/аккорда ждем реального нового щипка в полосе самой ноты
    if (target.requireFreshOnset && this.awaitingRepeatReAttack && targetMidis.length > 0) {
      const currentTargetMaxDb = Math.max(
        ...targetMidis.map((m) => this.computeMidiGoertzelDb(m, sampleRate))
      );

      if (currentTargetMaxDb < this.repeatMinBandDb) {
        this.repeatMinBandDb = currentTargetMaxDb;
      }
      if (shortRms < this.repeatMinShortRms) {
        this.repeatMinShortRms = shortRms;
      }

      const bandRePlucked =
        rms >= effectiveGate &&
        currentTargetMaxDb >= this.repeatMinBandDb + profile.repeatReAttackRiseDb &&
        currentTargetMaxDb > this.getMinNoteAbsDb();
      const recoveredFromSilence =
        this.repeatMinShortRms <= effectiveGate * 1.25 &&
        rms >= effectiveGate * 1.4;
      const strongRmsReAttack =
        rms > effectiveGate * 1.15 &&
        shortRms > this.repeatMinShortRms * 1.5 + 0.005;

      if (bandRePlucked || recoveredFromSilence || strongRmsReAttack) {
        this.awaitingRepeatReAttack = false;
        this.pitchVoteRing = [false, false, false];
        this.chordNoteHeardAt.clear();
        this.chordHasFreshRise = true;
      } else {
        return {
          rms,
          slapImpulse,
          slapTriggered: false,
          isOnset: false,
          waitingForAttack: rms >= effectiveGate,
          autoSlapCalibrated: autoCalibrated,
          matched: false,
          isWrongPitch: false,
          detectedLabel: null,
          cents: null,
          checkKind,
        };
      }
    }

    // 4. Чистый перкуссионный щелчок (X)
    if (checkKind === 'slap') {
      let confirmedSlap = slapTriggered;
      // Доп. поддержка мягкого заглушенного удара (dead note) с низкой периодичностью
      if (
        !confirmedSlap &&
        isOnset &&
        rms > effectiveGate * 1.3 &&
        yin.probability < (this.difficulty === 'arcade' ? 0.65 : 0.56)
      ) {
        confirmedSlap = true;
        this.lastSlapTimestamp = now;
      }

      return {
        rms,
        slapImpulse,
        slapTriggered: confirmedSlap,
        isOnset,
        waitingForAttack: false,
        autoSlapCalibrated: autoCalibrated,
        matched: confirmedSlap,
        isWrongPitch: false,
        detectedLabel: confirmedSlap ? 'Щелчок (X)' : null,
        cents: null,
        checkKind: 'slap',
      };
    }

    // 5. Смешанная доля: Щелчок (X) + нота/аккорд в окне 320 мс
    if (checkKind === 'mixed') {
      if (slapTriggered || (isOnset && slapImpulse >= 0.58)) {
        this.mixedSlapHeardAt = now;
      }

      if (rms >= effectiveGate) {
        const pitchHit =
          targetMidis.length === 1
            ? this.checkSinglePitchHybrid(
                targetMidis[0],
                rmsDb,
                yin,
                smoothedFreq,
                hasHarmonic,
                sampleRate,
                profile
              ).matched
            : this.evaluateChordAccumulated(
                targetMidis,
                rmsDb,
                isOnset,
                yin,
                smoothedFreq,
                sampleRate,
                now,
                profile
              ).matched;

        if (pitchHit) {
          this.mixedPitchHeardAt = now;
          this.mixedPitchLabel = targetMidis.map((m) => midiToLabel(m)).join(' ');
        }
      }

      const slapFresh = now - this.mixedSlapHeardAt <= 340;
      const pitchFresh = now - this.mixedPitchHeardAt <= 340;
      const bothMatched = slapFresh && pitchFresh;

      return {
        rms,
        slapImpulse,
        slapTriggered,
        isOnset,
        waitingForAttack: false,
        autoSlapCalibrated: autoCalibrated,
        matched: bothMatched,
        isWrongPitch: false,
        detectedLabel: bothMatched
          ? `X + ${this.mixedPitchLabel || midiToLabel(targetMidis[0])}`
          : slapFresh
          ? 'X (ждем ноту...)'
          : pitchFresh
          ? `${this.mixedPitchLabel} (ждем X...)`
          : null,
        cents: null,
        checkKind: 'mixed',
      };
    }

    // Ниже порога Noise Gate — тишина
    if (rms < effectiveGate) {
      this.pushPitchVote(false);
      return {
        rms,
        slapImpulse,
        slapTriggered: false,
        isOnset: false,
        waitingForAttack: false,
        autoSlapCalibrated: autoCalibrated,
        matched: false,
        isWrongPitch: false,
        detectedLabel: null,
        cents: null,
        checkKind,
      };
    }

    // 6. Одиночная нота -> Гибрид (Тюнерный YIN+Smoother + Goertzel детектор на фоне баса)
    if (checkKind === 'single') {
      const evalSingle = this.checkSinglePitchHybrid(
        targetMidis[0],
        rmsDb,
        yin,
        smoothedFreq,
        hasHarmonic,
        sampleRate,
        profile
      );

      const votes = this.pushPitchVote(evalSingle.matched);
      const confirmed = evalSingle.instantConfirm || votes >= 2;

      return {
        rms,
        slapImpulse,
        slapTriggered,
        isOnset,
        waitingForAttack: false,
        autoSlapCalibrated: autoCalibrated,
        matched: confirmed,
        isWrongPitch: !evalSingle.matched && evalSingle.isWrongPitch,
        detectedLabel: evalSingle.detectedLabel,
        cents: evalSingle.cents,
        checkKind: 'single',
      };
    }

    // 7. Аккорд (2+ нот) -> Гибрид YIN (главная нота) + Goertzel с защитой от обертонов
    const chordEval = this.evaluateChordAccumulated(
      targetMidis,
      rmsDb,
      isOnset,
      yin,
      smoothedFreq,
      sampleRate,
      now,
      profile
    );

    return {
      rms,
      slapImpulse,
      slapTriggered,
      isOnset,
      waitingForAttack: false,
      autoSlapCalibrated: autoCalibrated,
      matched: chordEval.matched,
      isWrongPitch: !chordEval.matched && isOnset && rms > effectiveGate * 1.9,
      detectedLabel: chordEval.detectedLabel,
      cents: null,
      checkKind: 'chord',
    };
  }

  private pushPitchVote(isHit: boolean): number {
    this.pitchVoteRing[this.pitchVoteIdx] = isHit;
    this.pitchVoteIdx = (this.pitchVoteIdx + 1) % 3;
    return (
      (this.pitchVoteRing[0] ? 1 : 0) +
      (this.pitchVoteRing[1] ? 1 : 0) +
      (this.pitchVoteRing[2] ? 1 : 0)
    );
  }

  private getMinNoteAbsDb(): number {
    const profile = DIFFICULTY_PROFILES[this.difficulty];
    const effectiveGate = this.noiseGateThreshold * profile.noiseGateMultiplier;
    const extraMargin = this.difficulty === 'arcade' ? 22 : this.difficulty === 'medium' ? 20 : 17;
    return 20 * Math.log10(effectiveGate) - extraMargin;
  }

  /**
   * Гибридная проверка одиночной ноты с учётом выбранного режима (Аркадный / Средний / Профи):
   * - Канал 1: Сглаженный тюнерный YIN
   * - Канал 2: Узкополосный Goertzel (ловит тихую ноту на фоне звучащего баса)
   */
  private checkSinglePitchHybrid(
    targetMidi: number,
    rmsDb: number,
    yin: { frequency: number | null; probability: number; rms: number },
    smoothedFreq: number | null,
    isHarmonic: boolean,
    sampleRate: number,
    profile: DifficultyProfile
  ): {
    matched: boolean;
    instantConfirm: boolean;
    isWrongPitch: boolean;
    detectedLabel: string | null;
    cents: number | null;
  } {
    const targetFreq = midiToFrequency(targetMidi);
    const freqToTest = smoothedFreq ?? yin.frequency;

    let detectedNearestMidi: number | null = null;
    let centsToTarget: number | null = null;

    // --- Канал 1: Тюнерный YIN + PitchSmoother ---
    if (freqToTest !== null && yin.probability >= profile.yinMinProb) {
      const detectedMidiFloat = 69 + 12 * Math.log2(freqToTest / 440);
      detectedNearestMidi = Math.round(detectedMidiFloat);
      centsToTarget = Math.round(1200 * Math.log2(freqToTest / targetFreq));

      const directMatch = Math.abs(centsToTarget) <= profile.centsTolerance;
      const allowOctave =
        profile.allowOctaveAllStrings || targetMidi <= 47 || isHarmonic;
      const upwardHarmonicAssist =
        allowOctave &&
        Math.abs(centsToTarget - 1200) <= Math.min(60, profile.centsTolerance) &&
        yin.probability >= Math.max(0.55, profile.yinMinProb) &&
        !this.previousBeatMidis.includes(detectedNearestMidi);
      const downwardOctaveAssist =
        profile.allowOctaveAllStrings &&
        Math.abs(centsToTarget + 1200) <= 60 &&
        yin.probability >= 0.58 &&
        !this.previousBeatMidis.includes(detectedNearestMidi);

      if (directMatch || upwardHarmonicAssist || downwardOctaveAssist) {
        const instantConfirm =
          (directMatch &&
            yin.probability >= profile.instantHitProb &&
            Math.abs(centsToTarget) <= profile.instantHitCents) ||
          (this.difficulty === 'arcade' && (upwardHarmonicAssist || downwardOctaveAssist));
        return {
          matched: true,
          instantConfirm,
          isWrongPitch: false,
          detectedLabel: midiToLabel(targetMidi),
          cents: directMatch ? centsToTarget : 0,
        };
      }
    }

    // --- Канал 2: Полифонический Goertzel (когда звучит прошлый бас и перебивает YIN) ---
    const targetPeak = this.measureMidiGoertzelPeak(targetMidi, sampleRate);
    const baselineDb = this.entryBaselineDb.get(targetMidi) ?? -95;
    const minAbsDb = this.getMinNoteAbsDb();
    const freshRiseDb = targetPeak.db - baselineDb;

    const isTargetFreshlyPlucked =
      targetPeak.db > minAbsDb &&
      targetPeak.db > rmsDb + profile.goertzelSingleRelDb &&
      freshRiseDb >= profile.goertzelSingleRiseDb;

    if (
      isTargetFreshlyPlucked &&
      this.isGoertzelPeakTonal(targetMidi, targetPeak, [], sampleRate, true, profile)
    ) {
      return {
        matched: true,
        instantConfirm: this.difficulty === 'arcade',
        isWrongPitch: false,
        detectedLabel: midiToLabel(targetMidi),
        cents: 0,
      };
    }

    const isWrongPitch =
      detectedNearestMidi !== null &&
      yin.probability > 0.76 &&
      Math.abs(detectedNearestMidi - targetMidi) >= 1 &&
      !this.previousBeatMidis.includes(detectedNearestMidi);

    return {
      matched: false,
      instantConfirm: false,
      isWrongPitch,
      detectedLabel:
        detectedNearestMidi !== null ? midiToLabel(detectedNearestMidi) : null,
      cents:
        centsToTarget !== null ? Math.max(-50, Math.min(50, centsToTarget)) : null,
    };
  }

  /**
   * Гибридное распознавание аккорда:
   * 1) Тюнерный YIN мгновенно засчитывает главную/слышимую ноту аккорда
   * 2) Точный Goertzel (f0 / 2·f0) с гармонической защитой плеч (обертоны струн не гасят друг друга!)
   * 3) Скользящее окно накопления (320 / 280 / 200 мс) для боя и фингерстайл-перебора
   */
  private evaluateChordAccumulated(
    targetMidis: number[],
    rmsDb: number,
    isOnset: boolean,
    yin: { frequency: number | null; probability: number; rms: number },
    smoothedFreq: number | null,
    sampleRate: number,
    now: number,
    profile: DifficultyProfile
  ): { matched: boolean; detectedLabel: string | null } {
    const minAbsDb = this.getMinNoteAbsDb();
    const relThreshold =
      targetMidis.length === 2 ? profile.chordDyadRelDb : profile.chordRelDb;
    const windowMs = profile.chordWindowMs;

    if (isOnset) {
      this.chordHasFreshRise = true;
    }

    // 1. Гибридная помощь от YIN: если YIN чётко слышит одну из нот аккорда (особенно бас/корень),
    //    сразу засчитываем её в копилку окна накопления!
    const freqToTest = smoothedFreq ?? yin.frequency;
    let yinMatchedMainNote = false;
    if (freqToTest !== null && yin.probability >= profile.yinMinProb) {
      for (const midi of targetMidis) {
        const targetFreq = midiToFrequency(midi);
        const cents = Math.round(1200 * Math.log2(freqToTest / targetFreq));
        const direct = Math.abs(cents) <= profile.centsTolerance;
        const octave =
          (profile.allowOctaveAllStrings || midi <= 47) &&
          Math.abs(cents - 1200) <= Math.min(60, profile.centsTolerance);
        if (direct || octave) {
          this.chordNoteHeardAt.set(midi, now);
          yinMatchedMainNote = true;
          if (!this.previousBeatMidis.includes(midi) || isOnset) {
            this.chordHasFreshRise = true;
          }
          break;
        }
      }
    }

    // 2. Полифонический Goertzel по каждой ноте аккорда
    for (const midi of targetMidis) {
      const peak = this.measureMidiGoertzelPeak(midi, sampleRate);
      const baselineDb = this.entryBaselineDb.get(midi) ?? -95;
      const deltaDb = peak.db - baselineDb;

      const isStrongNow = peak.db > minAbsDb && peak.db > rmsDb + relThreshold;
      const minDelta = this.difficulty === 'arcade' ? 3.2 : 4.0;
      const hadFreshRise =
        deltaDb >= minDelta ||
        !this.previousBeatMidis.includes(midi) ||
        this.chordHasFreshRise;

      if (
        isStrongNow &&
        hadFreshRise &&
        this.isGoertzelPeakTonal(midi, peak, targetMidis, sampleRate, false, profile)
      ) {
        this.chordNoteHeardAt.set(midi, now);
        if (deltaDb >= minDelta + 0.8) {
          this.chordHasFreshRise = true;
        }
      }
    }

    // Собираем ноты, услышанные в пределах скользящего окна
    const freshMatchedMidis: number[] = [];
    for (const midi of targetMidis) {
      const heardAt = this.chordNoteHeardAt.get(midi);
      if (heardAt !== undefined && now - heardAt <= windowMs) {
        freshMatchedMidis.push(midi);
      }
    }

    const matchedCount = freshMatchedMidis.length;
    const neededCount =
      targetMidis.length === 2
        ? profile.chordDyadNeeded
        : Math.max(
            profile.chordMinNeeded,
            Math.ceil(targetMidis.length * profile.chordRequiredRatio)
          );

    // В Аркадном режиме: засчитываем главную ноту аккорда (YIN или бас/сильный пик) при свежем ударе
    const rootMidi = targetMidis[0];
    const rootHeard = freshMatchedMidis.includes(rootMidi);
    const arcadeMainHit =
      profile.arcadeMainNoteChord &&
      this.chordHasFreshRise &&
      (yinMatchedMainNote || rootHeard || matchedCount >= 1);

    const chordMatched =
      (matchedCount >= neededCount && this.chordHasFreshRise) || arcadeMainHit;

    const freshLabels = freshMatchedMidis.map((m) => midiToLabel(m));
    const label =
      freshLabels.length > 0
        ? chordMatched
          ? freshLabels.slice(0, 3).join(' ')
          : `${freshLabels.slice(0, 2).join(' ')}…`
        : null;

    return {
      matched: chordMatched,
      detectedLabel: label,
    };
  }

  /**
   * Проверяет, что Goertzel-пик является настоящей тональной нотой, а не широкополосным шумом.
   * Гармонический фильтр плеч игнорирует f0, 2·f0 и 3·f0 других нот аккорда,
   * поэтому обертоны нижних струн (например, 2·G3 = 392 Гц рядом с F#4) не гасят аккорд!
   */
  private isGoertzelPeakTonal(
    midi: number,
    peak: { db: number; freq: number },
    chordMidis: number[],
    sampleRate: number,
    strictSingle: boolean,
    profile: DifficultyProfile
  ): boolean {
    const f = peak.freq;
    const isArcade = this.difficulty === 'arcade';

    // На басах полутон уже главного лепестка Ханна (~11.7 Гц), поэтому порог адаптирован к частоте
    const semiMargin = isArcade
      ? f < 130
        ? 0.0
        : f < 200
        ? 0.5
        : 1.0
      : f < 120
      ? 0.35
      : f < 180
      ? 1.0
      : strictSingle
      ? 2.2
      : 1.5;

    const lowerInChord = chordMidis.includes(midi - 1);
    const upperInChord = chordMidis.includes(midi + 1);

    if (!lowerInChord) {
      const lowerDb = this.goertzelAtFreqDb(
        peak.freq / Math.pow(2, 1 / 12),
        sampleRate
      );
      if (peak.db < lowerDb + semiMargin) return false;
    }

    if (!upperInChord) {
      const upperDb = this.goertzelAtFreqDb(
        peak.freq * Math.pow(2, 1 / 12),
        sampleRate
      );
      if (peak.db < upperDb + semiMargin) return false;
    }

    // В Аркадном режиме не отбрасываем ноты из-за плотных обертонов на плечах ±16 Гц
    if (!profile.useShoulderCheck) {
      return true;
    }

    const shoulderMargin = strictSingle
      ? profile.shoulderMarginSingle
      : profile.shoulderMarginChord;
    const shoulderOffsetHz = Math.max(16, f * 0.06);
    const lowShoulderFreq = f - shoulderOffsetHz;
    const highShoulderFreq = f + shoulderOffsetHz;

    // Исключаем проверку плеча, если рядом лежит f0, 2·f0 или 3·f0 любой другой ноты аккорда
    const nearChordOrHarmonic = (testFreq: number) =>
      chordMidis.some((m) => {
        if (m === midi) return false;
        const mf = midiToFrequency(m);
        return (
          Math.abs(mf - testFreq) < 14 ||
          Math.abs(mf * 2 - testFreq) < 16 ||
          Math.abs(mf * 3 - testFreq) < 18
        );
      });

    if (lowShoulderFreq > 45 && !nearChordOrHarmonic(lowShoulderFreq)) {
      const lowShoulderDb = this.goertzelAtFreqDb(lowShoulderFreq, sampleRate);
      if (peak.db < lowShoulderDb + shoulderMargin) return false;
    }

    if (!nearChordOrHarmonic(highShoulderFreq)) {
      const highShoulderDb = this.goertzelAtFreqDb(highShoulderFreq, sampleRate);
      if (peak.db < highShoulderDb + shoulderMargin) return false;
    }

    return true;
  }

  /**
   * Измеряет энергию ноты в dBFS и возвращает победившую частоту (f0 или 2·f0)
   */
  private measureMidiGoertzelPeak(
    midi: number,
    sampleRate: number
  ): { db: number; freq: number } {
    const profile = DIFFICULTY_PROFILES[this.difficulty];
    const f0 = midiToFrequency(midi);
    const db1 = this.goertzelAtFreqDb(f0, sampleRate);
    if (f0 < profile.goertzelHarmonicCutoffHz) {
      const db2Adj = this.goertzelAtFreqDb(f0 * 2, sampleRate) - 1.5;
      if (db2Adj > db1) {
        return { db: db2Adj, freq: f0 * 2 };
      }
    }
    return { db: db1, freq: f0 };
  }

  /**
   * Вычисляет точную узкополосную энергию ноты в dBFS алгоритмом Goertzel (с окном Ханна, без GC).
   */
  private computeMidiGoertzelDb(midi: number, sampleRate: number): number {
    return this.measureMidiGoertzelPeak(midi, sampleRate).db;
  }

  private goertzelAtFreqDb(targetFreq: number, sampleRate: number): number {
    const buf = this.timeDomainBuffer!;
    // Децимация x2: сохраняем полное 85 мс разрешение (11.7 Гц), снижая нагрузку на CPU вдвое
    const effectiveSampleRate = sampleRate * 0.5;
    if (targetFreq >= effectiveSampleRate * 0.45) return -100;

    const omega = (2 * Math.PI * targetFreq) / effectiveSampleRate;
    const coeff = 2 * Math.cos(omega);

    let s1 = 0;
    let s2 = 0;
    const count = Math.min(GOERTZEL_SAMPLES, Math.floor(buf.length / 2));

    for (let i = 0; i < count; i++) {
      const s0 = buf[i * 2] * HANN_WINDOW[i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s0;
    }

    const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
    const normMag = Math.sqrt(Math.max(power, 1e-18)) / (count * 0.5);
    return 20 * Math.log10(normMag + 1e-9);
  }

  private computeBandEnergyDb(
    sampleRate: number,
    lowHz: number,
    highHz: number
  ): number {
    const freqBins = this.freqDbBuffer!;
    const binResolution = sampleRate / this.analyser!.fftSize;
    const startBin = Math.max(1, Math.floor(lowHz / binResolution));
    const endBin = Math.min(
      freqBins.length - 1,
      Math.ceil(highHz / binResolution)
    );

    let sum = 0;
    let count = 0;
    for (let i = startBin; i <= endBin; i++) {
      if (Number.isFinite(freqBins[i])) {
        sum += freqBins[i];
        count++;
      }
    }
    return count > 0 ? sum / count : -100;
  }
}
