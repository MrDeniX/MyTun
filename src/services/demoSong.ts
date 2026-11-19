import { STANDARD_OPEN_MIDI, SongScore } from '../types/tabs';

/**
 * Встроенный демонстрационный фингерстайл-этюд для мгновенного тестирования всех возможностей:
 * - Одиночные мелодические ноты (YIN + onset detection)
 * - Аккорды (FFT multi-peak check)
 * - Перкуссионные слапы (X / broadband transient)
 * - Hammer-on, Slide, Флажолеты <12>
 * - Смена каподастра прямо посреди партии ("Move capo to 1st fret")
 */
export const BUILTIN_DEMO_SONG: SongScore = {
  id: 'demo-midnight-fingerstyle',
  title: 'Midnight Pulse (Фингерстайл Демо)',
  artist: 'TONE.01 Studio',
  bpm: 88,
  tuning: {
    name: 'Standard',
    openStringMidi: [...STANDARD_OPEN_MIDI],
  },
  capo: 0,
  source: 'demo',
  isDemo: true,
  createdAt: 1700000000000,
  measures: [
    {
      index: 1,
      timeSignature: { beats: 4, value: 4 },
      marker: 'Intro · Em9',
      beats: [
        {
          id: 'm1-b1',
          duration: 1,
          notes: [
            { string: 6, fret: 0, technique: 'normal' },
            { string: 3, fret: 0, technique: 'normal' },
            { string: 2, fret: 0, technique: 'normal' },
          ],
        },
        {
          id: 'm1-b2',
          duration: 0.5,
          notes: [{ string: 1, fret: 2, technique: 'normal' }],
        },
        {
          id: 'm1-b3',
          duration: 0.5,
          notes: [{ string: 1, fret: 3, technique: 'hammer' }],
        },
        {
          id: 'm1-b4',
          duration: 1,
          notes: [{ string: 6, fret: -1, technique: 'slap' }],
        },
        {
          id: 'm1-b5',
          duration: 1,
          notes: [{ string: 2, fret: 0, technique: 'normal' }],
        },
      ],
    },
    {
      index: 2,
      timeSignature: { beats: 4, value: 4 },
      beats: [
        {
          id: 'm2-b1',
          duration: 1,
          notes: [
            { string: 5, fret: 3, technique: 'normal' },
            { string: 3, fret: 0, technique: 'normal' },
            { string: 2, fret: 1, technique: 'normal' },
          ],
        },
        {
          id: 'm2-b2',
          duration: 1,
          notes: [{ string: 1, fret: 0, technique: 'normal' }],
        },
        {
          id: 'm2-b3',
          duration: 1,
          notes: [{ string: 6, fret: -1, technique: 'slap' }],
        },
        {
          id: 'm2-b4',
          duration: 1,
          notes: [{ string: 1, fret: 12, technique: 'harmonic' }],
        },
      ],
    },
    {
      index: 3,
      timeSignature: { beats: 4, value: 4 },
      beats: [
        {
          id: 'm3-b1',
          duration: 1,
          notes: [
            { string: 6, fret: 3, technique: 'normal' },
            { string: 2, fret: 0, technique: 'normal' },
            { string: 1, fret: 3, technique: 'normal' },
          ],
        },
        {
          id: 'm3-b2',
          duration: 0.5,
          notes: [{ string: 2, fret: 3, technique: 'normal' }],
        },
        {
          id: 'm3-b3',
          duration: 0.5,
          notes: [{ string: 2, fret: 5, technique: 'slide' }],
        },
        {
          id: 'm3-b4',
          duration: 1,
          notes: [
            { string: 6, fret: -1, technique: 'slap' },
            { string: 1, fret: 3, technique: 'normal' },
          ],
        },
        {
          id: 'm3-b5',
          duration: 1,
          notes: [{ string: 3, fret: 0, technique: 'normal' }],
        },
      ],
    },
    {
      index: 4,
      timeSignature: { beats: 4, value: 4 },
      beats: [
        {
          id: 'm4-b1',
          duration: 1,
          notes: [
            { string: 4, fret: 0, technique: 'normal' },
            { string: 3, fret: 2, technique: 'normal' },
            { string: 2, fret: 3, technique: 'normal' },
          ],
        },
        {
          id: 'm4-b2',
          duration: 1,
          notes: [{ string: 1, fret: 2, technique: 'normal' }],
        },
        {
          id: 'm4-b3',
          duration: 1,
          notes: [{ string: 3, fret: 2, technique: 'ghost' }],
        },
        {
          id: 'm4-b4',
          duration: 1,
          notes: [{ string: 2, fret: 12, technique: 'harmonic' }],
        },
      ],
    },
    {
      index: 5,
      timeSignature: { beats: 4, value: 4 },
      capoChange: 1,
      marker: 'Move capo to 1st fret',
      beats: [
        {
          id: 'm5-b1',
          duration: 1,
          notes: [
            { string: 6, fret: 0, technique: 'normal' },
            { string: 4, fret: 2, technique: 'normal' },
            { string: 2, fret: 0, technique: 'normal' },
          ],
        },
        {
          id: 'm5-b2',
          duration: 1,
          notes: [{ string: 1, fret: 0, technique: 'normal' }],
        },
        {
          id: 'm5-b3',
          duration: 1,
          notes: [{ string: 6, fret: -1, technique: 'slap' }],
        },
        {
          id: 'm5-b4',
          duration: 1,
          notes: [{ string: 1, fret: 3, technique: 'hammer' }],
        },
      ],
    },
    {
      index: 6,
      timeSignature: { beats: 4, value: 4 },
      marker: 'Outro · Fm',
      beats: [
        {
          id: 'm6-b1',
          duration: 1,
          notes: [
            { string: 5, fret: 0, technique: 'normal' },
            { string: 3, fret: 2, technique: 'normal' },
            { string: 2, fret: 1, technique: 'normal' },
          ],
        },
        {
          id: 'm6-b2',
          duration: 1,
          notes: [{ string: 1, fret: 0, technique: 'normal' }],
        },
        {
          id: 'm6-b3',
          duration: 2,
          notes: [
            { string: 6, fret: 0, technique: 'normal' },
            { string: 3, fret: 0, technique: 'normal' },
            { string: 1, fret: 0, technique: 'normal' },
          ],
        },
      ],
    },
  ],
};
