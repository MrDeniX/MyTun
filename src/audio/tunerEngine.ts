import { ensureAudioContextResumed, getSharedAudioContext } from './audioContextManager';
import { PitchSmoother, detectPitchYIN } from './yinPitchDetector';

export interface TunerFrameData {
  /** Сглаженная частота в Гц или null в состоянии тишины */
  frequency: number | null;
  /** Уровень входного сигнала (RMS 0..1) */
  rms: number;
  /** Вероятность периодичности YIN (0..1) */
  probability: number;
}

export type TunerCallback = (data: TunerFrameData) => void;

/**
 * Аудио-движок гитарного тюнера на базе Web Audio API.
 * Отвечает за захват сырого потока микрофона (без фильтров речи),
 * непрерывный анализ высоты тона YIN и синтез эталонного тона струны.
 */
export class TunerEngine {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private timeDomainBuffer: Float32Array<ArrayBuffer> | null = null;
  private rafId: number | null = null;
  private smoother = new PitchSmoother(5, 0.36);
  private isRunning = false;
  private onFrameCallback: TunerCallback | null = null;
  private silenceFrames = 0;

  // Порог шумоподавления (RMS Noise Gate)
  private rmsThreshold = 0.0075;

  // Узлы синтезатора эталонного тона струны
  private refOscillators: OscillatorNode[] = [];
  private refGainNode: GainNode | null = null;
  private refStopTimeout: number | null = null;

  public setCallback(cb: TunerCallback): void {
    this.onFrameCallback = cb;
  }

  public setNoiseGateThreshold(threshold: number): void {
    this.rmsThreshold = Math.max(0.002, Math.min(0.05, threshold));
  }

  public getNoiseGateThreshold(): number {
    return this.rmsThreshold;
  }

  private ensureAudioContext(): AudioContext {
    this.audioContext = getSharedAudioContext();
    return this.audioContext;
  }

  /**
   * Запускает захват микрофона с отключенными фильтрами речи.
   * Вызывается строго внутри пользовательского обработчика нажатия (iOS Safari политика).
   */
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
    // 4096 сэмплов дают достаточное окно (~85-92 мс) для низких басовых струн (D2 = 73.4 Гц, E2 = 82.4 Гц)
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0;

    this.sourceNode.connect(this.analyser);
    this.timeDomainBuffer = new Float32Array(this.analyser.fftSize);
    this.smoother.reset();
    this.silenceFrames = 0;
    this.isRunning = true;

    this.loop();
  }

  /**
   * Останавливает захват микрофона и освобождает аппаратный доступ
   */
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
    this.smoother.reset();
  }

  /**
   * Проигрывает чистый акустически-приятный эталонный тон выбранной струны (3.2 секунды с плавным затуханием)
   */
  public async playReferenceTone(frequency: number, onEnded?: () => void): Promise<void> {
    this.stopReferenceTone();

    const ctx = this.ensureAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    const now = ctx.currentTime;
    const duration = 3.2;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.exponentialRampToValueAtTime(0.28, now + 0.03);
    masterGain.gain.exponentialRampToValueAtTime(0.14, now + 0.7);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    masterGain.connect(ctx.destination);

    // Синтез основного тона + мягких 2-й и 3-й гармоник для читаемости на динамике смартфона
    const harmonics = [
      { ratio: 1, gain: 0.7, type: 'triangle' as OscillatorType },
      { ratio: 2, gain: 0.22, type: 'sine' as OscillatorType },
      { ratio: 3, gain: 0.08, type: 'sine' as OscillatorType },
    ];

    const oscs: OscillatorNode[] = [];
    for (const h of harmonics) {
      const osc = ctx.createOscillator();
      const hGain = ctx.createGain();
      osc.type = h.type;
      osc.frequency.setValueAtTime(frequency * h.ratio, now);
      hGain.gain.setValueAtTime(h.gain, now);

      osc.connect(hGain);
      hGain.connect(masterGain);
      osc.start(now);
      osc.stop(now + duration);
      oscs.push(osc);
    }

    this.refOscillators = oscs;
    this.refGainNode = masterGain;

    this.refStopTimeout = window.setTimeout(() => {
      this.stopReferenceTone();
      if (onEnded) onEnded();
    }, duration * 1000);
  }

  public stopReferenceTone(): void {
    if (this.refStopTimeout !== null) {
      clearTimeout(this.refStopTimeout);
      this.refStopTimeout = null;
    }
    for (const osc of this.refOscillators) {
      try {
        osc.stop();
        osc.disconnect();
      } catch {
        // ignore
      }
    }
    this.refOscillators = [];
    if (this.refGainNode) {
      try {
        this.refGainNode.disconnect();
      } catch {
        // ignore
      }
      this.refGainNode = null;
    }
  }

  private loop = (): void => {
    if (!this.isRunning || !this.analyser || !this.timeDomainBuffer || !this.audioContext) {
      return;
    }

    this.analyser.getFloatTimeDomainData(this.timeDomainBuffer);
    const result = detectPitchYIN(
      this.timeDomainBuffer,
      this.audioContext.sampleRate,
      this.rmsThreshold,
      0.15
    );

    if (result.frequency !== null && result.probability > 0.68) {
      this.silenceFrames = 0;
      const smoothed = this.smoother.push(result.frequency);
      this.onFrameCallback?.({
        frequency: smoothed,
        rms: result.rms,
        probability: result.probability,
      });
    } else {
      this.silenceFrames++;
      // Держим последнее показание ~18 кадров (~300 мс), чтобы дисплей не мигал при затухании струны
      if (this.silenceFrames > 18) {
        this.smoother.reset();
        this.onFrameCallback?.({
          frequency: null,
          rms: result.rms,
          probability: 0,
        });
      }
    }

    this.rafId = requestAnimationFrame(this.loop);
  };
}
