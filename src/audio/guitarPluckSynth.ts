import { TabNote, computeNoteTargetMidi, midiToFrequency } from '../types/tabs';
import { ensureAudioContextResumed, getSharedAudioContext } from './audioContextManager';

/**
 * Web Audio синтезатор предпрослушивания табулатуры (Звуковой гид).
 * Создает мягкий акустический щипок через OscillatorNode + BiquadFilterNode (lowpass-огибающая)
 * и перкуссионный щелчок (filtered noise burst) для слапов X.
 */
export class GuitarPluckSynth {
  private noiseBuffer: AudioBuffer | null = null;
  private volume = 0.65;

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === ctx.sampleRate) {
      return this.noiseBuffer;
    }
    const length = Math.floor(ctx.sampleRate * 0.08);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (length * 0.25));
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  /**
   * Синтезирует все ноты одного бита (одиночная нота, аккорд или перкуссионный слап)
   * в точный момент startTime по часам AudioContext
   */
  public scheduleBeatNotes(
    notes: TabNote[],
    openStringMidi: number[],
    currentCapo: number,
    startTime?: number,
    durationSec = 0.7
  ): void {
    const ctx = getSharedAudioContext();
    if (ctx.state === 'suspended') {
      void ensureAudioContextResumed();
    }
    const t0 = startTime ?? ctx.currentTime;
    const clampedDur = Math.max(0.25, Math.min(2.2, durationSec));

    notes.forEach((note, idx) => {
      // Небольшой микро-перебор 8 мс для натуральности аккорда
      const strumOffset = notes.length > 1 ? idx * 0.008 : 0;
      const noteStart = t0 + strumOffset;

      if (note.technique === 'slap' || note.fret < 0) {
        this.scheduleSlap(ctx, noteStart);
        return;
      }

      const midi = computeNoteTargetMidi(note, openStringMidi, currentCapo);
      if (midi === null) return;

      const freq = midiToFrequency(midi);
      const isGhost = note.technique === 'ghost';
      const isHarmonic = note.technique === 'harmonic';

      this.schedulePluck(ctx, freq, noteStart, clampedDur, isGhost, isHarmonic);
    });
  }

  private schedulePluck(
    ctx: AudioContext,
    freq: number,
    startTime: number,
    durationSec: number,
    isGhost: boolean,
    isHarmonic: boolean
  ): void {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = isHarmonic ? 'sine' : 'sawtooth';
    osc.frequency.setValueAtTime(freq, startTime);

    filter.type = 'lowpass';
    const startCutoff = isHarmonic ? freq * 4 : Math.min(4800, freq * 7.5);
    const endCutoff = Math.max(280, freq * 1.6);
    filter.Q.setValueAtTime(isHarmonic ? 3.5 : 1.4, startTime);
    filter.frequency.setValueAtTime(startCutoff, startTime);
    filter.frequency.exponentialRampToValueAtTime(
      endCutoff,
      startTime + Math.min(0.35, durationSec * 0.65)
    );

    const peakAmp = (isGhost ? 0.08 : isHarmonic ? 0.19 : 0.16) * this.volume;
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peakAmp, startTime + 0.006);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, peakAmp * 0.35),
      startTime + durationSec * 0.45
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + durationSec + 0.02);
  }

  private scheduleSlap(ctx: AudioContext, startTime: number): void {
    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoiseBuffer(ctx);

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(1600, startTime);
    bandpass.Q.setValueAtTime(1.2, startTime);

    const gain = ctx.createGain();
    const peak = 0.42 * this.volume;
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peak, startTime + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.065);

    noise.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(ctx.destination);

    noise.start(startTime);
    noise.stop(startTime + 0.075);
  }

  /**
   * Планирует короткий клик метронома на точное время AudioContext для режима Play Along
   */
  public scheduleMetronomeClick(startTime: number, isAccent: boolean): void {
    const ctx = getSharedAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(isAccent ? 1280 : 840, startTime);
    osc.frequency.exponentialRampToValueAtTime(isAccent ? 640 : 420, startTime + 0.025);

    const peak = (isAccent ? 0.52 : 0.32) * this.volume;
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peak, startTime + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.038);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + 0.042);
  }
}
