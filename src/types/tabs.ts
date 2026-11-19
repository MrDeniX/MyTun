import {
  CHROMATIC_NOTES,
  GuitarString,
  NoteName,
  REFERENCE_A4,
  TuningPreset,
  createGuitarString,
} from './tuning';

export type NoteTechnique =
  | 'normal'
  | 'hammer'
  | 'slide'
  | 'harmonic'
  | 'slap'
  | 'ghost';

export interface TabNote {
  /** Номер струны: 1 (самая тонкая, высокая e) .. 6 (самая толстая, басовая E) */
  string: number;
  /** Номер лада (0 — открытая струна, -1 для чисто перкуссионного слапа без лада) */
  fret: number;
  technique: NoteTechnique;
}

export interface TabBeat {
  id: string;
  /** Длительность в долях четверти (0.25 = 16-я, 0.5 = 8-я, 1 = четверть, 2 = половинная, 4 = целая) */
  duration: number;
  isRest?: boolean;
  notes: TabNote[];
}

export interface TabMeasure {
  /** Номер такта (1-based) */
  index: number;
  timeSignature?: {
    beats: number;
    value: number;
  };
  /** Смена темпа на этом такте (BPM) */
  tempoOverride?: number;
  /** Абсолютный лад каподастра, начиная с этого такта (если указан) */
  capoChange?: number;
  /** Текстовый маркер над тактом (например, "Move capo to 1st fret", "Verse", "Chorus") */
  marker?: string;
  beats: TabBeat[];
}

export interface SongTuning {
  name: string;
  /**
   * MIDI-ноты 6 открытых струн от 6-й (басовой) к 1-й (тонкой).
   * Например, Standard: [40, 45, 50, 55, 59, 64] (E2 A2 D3 G3 B3 E4).
   */
  openStringMidi: number[];
}

export interface SongScore {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  tuning: SongTuning;
  /** Начальный каподастр (0 = без каподастра) */
  capo: number;
  measures: TabMeasure[];
  source: 'demo' | 'alphatab' | 'ascii' | 'ai-pdf';
  isDemo?: boolean;
  bestAccuracy?: number;
  createdAt: number;
}

export type BeatEvaluationStatus =
  | 'idle'
  | 'active'
  | 'hit'
  | 'wrong'
  | 'missed'
  | 'skipped';

export interface FlatBeatPointer {
  flatIndex: number;
  measureIndex: number; // 0-based index in measures[]
  measureNumber: number; // 1-based display index
  beatIndexInMeasure: number;
  beat: TabBeat;
  effectiveBpm: number;
  effectiveCapo: number;
  marker?: string;
}

export const STANDARD_OPEN_MIDI = [40, 45, 50, 55, 59, 64]; // 6:E2, 5:A2, 4:D3, 3:G3, 2:B3, 1:E4

/**
 * Конвертирует MIDI-номер ноты в частоту в Гц (A4 = 440 Гц, MIDI 69)
 */
export function midiToFrequency(midi: number, a4 = REFERENCE_A4): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Конвертирует MIDI-номер в название ноты и октаву (например, 40 -> { note: 'E', octave: 2 })
 */
export function midiToNoteParts(midi: number): { note: NoteName; octave: number } {
  const rounded = Math.round(midi);
  const octave = Math.floor(rounded / 12) - 1;
  const idx = ((rounded % 12) + 12) % 12;
  return {
    note: CHROMATIC_NOTES[idx],
    octave,
  };
}

/**
 * Форматирует MIDI-номер в строку вроде "E2"
 */
export function midiToLabel(midi: number): string {
  const { note, octave } = midiToNoteParts(midi);
  return `${note}${octave}`;
}

/**
 * Получает MIDI-номер открытой струны по её гитарному номеру (stringNum: 6..1)
 */
export function getOpenMidiForString(
  openStringMidi: number[],
  stringNum: number
): number {
  const safeMidi =
    openStringMidi.length === 6 ? openStringMidi : STANDARD_OPEN_MIDI;
  // index 0 -> 6-я струна, index 5 -> 1-я струна
  const idx = Math.max(0, Math.min(5, 6 - stringNum));
  return safeMidi[idx];
}

/**
 * Вычисляет целевой MIDI для конкретной ноты таба:
 * TargetMIDI = OpenStringMIDI[string] + CurrentCapo + Fret
 */
export function computeNoteTargetMidi(
  note: TabNote,
  openStringMidi: number[],
  currentCapo: number
): number | null {
  if (note.technique === 'slap' || note.fret < 0) {
    return null;
  }
  const openMidi = getOpenMidiForString(openStringMidi, note.string);
  return openMidi + currentCapo + note.fret;
}

/**
 * Разворачивает все такты и доли партитуры в плоскую последовательность
 * с предрасчитанным каподастром и темпом на каждом бите
 */
export function flattenSongBeats(
  song: SongScore,
  manualCapoOffset = 0
): FlatBeatPointer[] {
  const result: FlatBeatPointer[] = [];
  let runningCapo = song.capo;
  let runningBpm = song.bpm;
  let flatIndex = 0;

  song.measures.forEach((measure, mIdx) => {
    if (typeof measure.capoChange === 'number') {
      runningCapo = measure.capoChange;
    }
    if (typeof measure.tempoOverride === 'number' && measure.tempoOverride >= 30) {
      runningBpm = measure.tempoOverride;
    }

    const effectiveCapo = Math.max(0, Math.min(12, runningCapo + manualCapoOffset));

    measure.beats.forEach((beat, bIdx) => {
      result.push({
        flatIndex,
        measureIndex: mIdx,
        measureNumber: measure.index,
        beatIndexInMeasure: bIdx,
        beat,
        effectiveBpm: runningBpm,
        effectiveCapo,
        marker: bIdx === 0 ? measure.marker : undefined,
      });
      flatIndex++;
    });
  });

  return result;
}

/**
 * Конвертирует строй из SongScore в формат TuningPreset для мгновенного применения в Тюнере
 */
export function convertSongTuningToPreset(song: SongScore): TuningPreset {
  const openMidis =
    song.tuning.openStringMidi.length === 6
      ? song.tuning.openStringMidi
      : STANDARD_OPEN_MIDI;

  const strings: GuitarString[] = openMidis.map((midi, idx) => {
    const { note, octave } = midiToNoteParts(midi);
    return createGuitarString(6 - idx, note, octave);
  });

  const subtitle = strings.map((s) => `${s.note}${s.octave}`).join(' ');
  return {
    id: `tab-tuning-${subtitle.replace(/\s+/g, '-').toLowerCase()}`,
    name: song.tuning.name || `Строй (${song.title})`,
    subtitle,
    isCustom: true,
    strings,
  };
}

/**
 * Пытается распознать смену каподастра из текстового маркера вроде "Move capo to 1st fret" или "Capo 2"
 */
export function parseCapoFromMarker(marker?: string): number | undefined {
  if (!marker) return undefined;
  const lower = marker.toLowerCase();
  if (lower.includes('remove capo') || lower.includes('no capo') || lower.includes('capo 0')) {
    return 0;
  }
  const match = lower.match(/capo(?:\s+to)?\s+(\d{1,2})(?:st|nd|rd|th)?/);
  if (match) {
    const val = parseInt(match[1], 10);
    if (!Number.isNaN(val) && val >= 0 && val <= 12) {
      return val;
    }
  }
  return undefined;
}
