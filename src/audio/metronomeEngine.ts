import { TimeSignature } from '../types/tuning';
import { ensureAudioContextResumed } from './audioContextManager';

export interface ScheduledBeatEvent {
  beatIndex: number;
  isAccent: boolean;
  time: number;
}

export type BeatVisualCallback = (beatIndex: number, isAccent: boolean) => void;

/**
 * Высокоточный аудио-движок метронома с двухуровневым Lookahead-планировщиком
 * по архитектуре Chris Wilson ("A Tale of Two Clocks").
 *
 * - Планировщик setTimeout запускается каждые 25 мс
 * - Планирует клики вперед на 100 мс (0.1 с) строго через audioContext.currentTime
 * - Визуальный цикл requestAnimationFrame считывает очередь запланированных долей
 *   для идеальной синхронизации звука, точек и пульсации экрана.
 */
export class MetronomeEngine {
  private audioContext: AudioContext | null = null;
  private isPlaying = false;
  private bpm = 120;
  private beatsPerBar = 4;
  private noteValue = 4;
  private accentFirstBeat = true;
  private volume = 0.8;

  private currentBeat = 0;
  private nextNoteTime = 0.0;
  private readonly lookaheadMs = 25.0; // Как часто вызывается функция планирования (мс)
  private readonly scheduleAheadTimeSec = 0.1; // На сколько секунд вперед планируем аудио (100 мс)

  private timerId: number | null = null;
  private rafId: number | null = null;
  private scheduledQueue: ScheduledBeatEvent[] = [];
  private onBeatVisual: BeatVisualCallback | null = null;

  public setVisualCallback(cb: BeatVisualCallback): void {
    this.onBeatVisual = cb;
  }

  public setBpm(bpm: number): void {
    this.bpm = Math.max(30, Math.min(240, Math.round(bpm)));
  }

  public getBpm(): number {
    return this.bpm;
  }

  public setTimeSignature(sig: TimeSignature): void {
    const [beats, value] = sig.split('/').map(Number);
    this.beatsPerBar = beats || 4;
    this.noteValue = value || 4;
    if (this.currentBeat >= this.beatsPerBar) {
      this.currentBeat = 0;
    }
  }

  public setAccentFirstBeat(accent: boolean): void {
    this.accentFirstBeat = accent;
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
  }

  public async start(): Promise<void> {
    if (this.isPlaying) return;

    const ctx = await ensureAudioContextResumed();
    this.audioContext = ctx;

    this.isPlaying = true;
    this.currentBeat = 0;
    this.scheduledQueue = [];
    // Небольшой запас 50 мс перед первым кликом для исключения проглатывания атаки
    this.nextNoteTime = ctx.currentTime + 0.05;

    this.scheduler();
    this.visualLoop();
  }

  public stop(): void {
    this.isPlaying = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.scheduledQueue = [];
  }

  private scheduler = (): void => {
    if (!this.isPlaying || !this.audioContext) return;

    while (this.nextNoteTime < this.audioContext.currentTime + this.scheduleAheadTimeSec) {
      this.scheduleNote(this.currentBeat, this.nextNoteTime);
      this.advanceNote();
    }

    this.timerId = window.setTimeout(this.scheduler, this.lookaheadMs);
  };

  private scheduleNote(beatNumber: number, time: number): void {
    if (!this.audioContext) return;

    const isAccent = this.accentFirstBeat && beatNumber === 0;
    this.scheduledQueue.push({
      beatIndex: beatNumber,
      isAccent,
      time,
    });

    if (this.volume <= 0.001) return;

    // Синтез короткого студийного перкуссионного импульса (OscillatorNode + GainNode)
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    osc.type = 'triangle';
    // Высокий четкий импульс на сильную долю (1320 Гц -> 660 Гц) и мягкий плотный на слабые (880 Гц -> 440 Гц)
    const startFreq = isAccent ? 1320 : 880;
    const endFreq = isAccent ? 660 : 440;

    osc.frequency.setValueAtTime(startFreq, time);
    osc.frequency.exponentialRampToValueAtTime(endFreq, time + 0.028);

    const peakGain = (isAccent ? 0.95 : 0.62) * this.volume;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peakGain, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.042);

    osc.connect(gain);
    gain.connect(this.audioContext.destination);

    osc.start(time);
    osc.stop(time + 0.045);
  }

  private advanceNote(): void {
    // Для размера 6/8 восьмая длительность в 2 раза быстрее четверти, либо стандартный шаг доли
    const secondsPerQuarter = 60.0 / this.bpm;
    const beatDuration =
      this.noteValue === 8 ? secondsPerQuarter * 0.5 : secondsPerQuarter;

    this.nextNoteTime += beatDuration;
    this.currentBeat = (this.currentBeat + 1) % this.beatsPerBar;
  }

  private visualLoop = (): void => {
    if (!this.isPlaying || !this.audioContext) return;

    const currentTime = this.audioContext.currentTime;
    while (this.scheduledQueue.length > 0 && this.scheduledQueue[0].time <= currentTime) {
      const event = this.scheduledQueue.shift()!;
      this.onBeatVisual?.(event.beatIndex, event.isAccent);
    }

    this.rafId = requestAnimationFrame(this.visualLoop);
  };
}
