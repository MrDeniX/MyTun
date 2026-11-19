export type NoteName =
  | 'C'
  | 'C#'
  | 'D'
  | 'Eb'
  | 'E'
  | 'F'
  | 'F#'
  | 'G'
  | 'G#'
  | 'A'
  | 'Bb'
  | 'B';

export const CHROMATIC_NOTES: NoteName[] = [
  'C',
  'C#',
  'D',
  'Eb',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'Bb',
  'B',
];

export interface GuitarString {
  /** Номер струны: 6 (самая толстая басовая) .. 1 (самая тонкая) */
  stringNumber: number;
  note: NoteName;
  octave: number;
  /** Эталонная частота в Гц при A4 = 440 Гц */
  frequency: number;
}

export interface TuningPreset {
  id: string;
  name: string;
  subtitle: string;
  isCustom?: boolean;
  /** Массив из 6 струн: от 6-й (басовой) к 1-й (высокой) */
  strings: GuitarString[];
}

export type TimeSignature = '2/4' | '3/4' | '4/4' | '6/8';

export const REFERENCE_A4 = 440.0;

/**
 * Вычисляет частоту ноты в Гц по названию ноты и октаве (A4 = 440 Гц, MIDI 69)
 */
export function calculateNoteFrequency(note: NoteName, octave: number, a4 = REFERENCE_A4): number {
  const noteIndex = CHROMATIC_NOTES.indexOf(note);
  const midi = (octave + 1) * 12 + noteIndex;
  const freq = a4 * Math.pow(2, (midi - 69) / 12);
  return Math.round(freq * 100) / 100;
}

/**
 * Создает объект струны с автоматически рассчитанной частотой
 */
export function createGuitarString(
  stringNumber: number,
  note: NoteName,
  octave: number
): GuitarString {
  return {
    stringNumber,
    note,
    octave,
    frequency: calculateNoteFrequency(note, octave),
  };
}

/**
 * Сдвигает ноту и октаву на заданное число полутонов (с ограничением диапазона C1..B5)
 */
export function shiftNoteBySemitones(
  note: NoteName,
  octave: number,
  deltaSemitones: number
): { note: NoteName; octave: number; frequency: number } {
  const noteIndex = CHROMATIC_NOTES.indexOf(note);
  const currentMidi = (octave + 1) * 12 + noteIndex;
  const minMidi = 24; // C1 (~32.7 Гц)
  const maxMidi = 83; // B5 (~987.77 Гц)
  const nextMidi = Math.max(minMidi, Math.min(maxMidi, currentMidi + deltaSemitones));

  const nextOctave = Math.floor(nextMidi / 12) - 1;
  const nextNoteIndex = ((nextMidi % 12) + 12) % 12;
  const nextNote = CHROMATIC_NOTES[nextNoteIndex];

  return {
    note: nextNote,
    octave: nextOctave,
    frequency: calculateNoteFrequency(nextNote, nextOctave),
  };
}

/**
 * Находит ближайшую хроматическую ноту для произвольной частоты (Гц)
 */
export function getChromaticNoteFromFrequency(
  frequency: number,
  a4 = REFERENCE_A4
): { note: NoteName; octave: number; targetFrequency: number; cents: number } {
  const midiFloat = 69 + 12 * Math.log2(frequency / a4);
  const nearestMidi = Math.round(midiFloat);
  const cents = Math.round((midiFloat - nearestMidi) * 100);
  const octave = Math.floor(nearestMidi / 12) - 1;
  const noteIndex = ((nearestMidi % 12) + 12) % 12;
  const note = CHROMATIC_NOTES[noteIndex];
  const targetFrequency = a4 * Math.pow(2, (nearestMidi - 69) / 12);

  return {
    note,
    octave,
    targetFrequency,
    cents,
  };
}

/**
 * Вычисляет отклонение в центах между измеренной частотой и целевой частотой струны
 */
export function calculateCentsDeviation(detectedFreq: number, targetFreq: number): number {
  const cents = 1200 * Math.log2(detectedFreq / targetFreq);
  return Math.max(-50, Math.min(50, Math.round(cents)));
}
