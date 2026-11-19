import {
  GuitarString,
  NoteName,
  TuningPreset,
  createGuitarString,
} from '../types/tuning';

const CUSTOM_TUNINGS_KEY = 'tone01_custom_tunings_v1';
const ACTIVE_TUNING_ID_KEY = 'tone01_active_tuning_id_v1';

/**
 * Встроенные гитарные пресеты (от 6-й струны к 1-й)
 */
export const BUILTIN_TUNING_PRESETS: TuningPreset[] = [
  {
    id: 'standard',
    name: 'Standard',
    subtitle: 'E2 A2 D3 G3 B3 E4',
    strings: [
      createGuitarString(6, 'E', 2),
      createGuitarString(5, 'A', 2),
      createGuitarString(4, 'D', 3),
      createGuitarString(3, 'G', 3),
      createGuitarString(2, 'B', 3),
      createGuitarString(1, 'E', 4),
    ],
  },
  {
    id: 'drop-d',
    name: 'Drop D',
    subtitle: 'D2 A2 D3 G3 B3 E4',
    strings: [
      createGuitarString(6, 'D', 2),
      createGuitarString(5, 'A', 2),
      createGuitarString(4, 'D', 3),
      createGuitarString(3, 'G', 3),
      createGuitarString(2, 'B', 3),
      createGuitarString(1, 'E', 4),
    ],
  },
  {
    id: 'half-step-down',
    name: 'Half-Step Down (Eb)',
    subtitle: 'Eb2 G#2 C#3 F#3 Bb3 Eb4',
    strings: [
      createGuitarString(6, 'Eb', 2),
      createGuitarString(5, 'G#', 2),
      createGuitarString(4, 'C#', 3),
      createGuitarString(3, 'F#', 3),
      createGuitarString(2, 'Bb', 3),
      createGuitarString(1, 'Eb', 4),
    ],
  },
  {
    id: 'full-step-down',
    name: 'Full-Step Down (D)',
    subtitle: 'D2 G2 C3 F3 A3 D4',
    strings: [
      createGuitarString(6, 'D', 2),
      createGuitarString(5, 'G', 2),
      createGuitarString(4, 'C', 3),
      createGuitarString(3, 'F', 3),
      createGuitarString(2, 'A', 3),
      createGuitarString(1, 'D', 4),
    ],
  },
  {
    id: 'open-g',
    name: 'Open G',
    subtitle: 'D2 G2 D3 G3 B3 D4',
    strings: [
      createGuitarString(6, 'D', 2),
      createGuitarString(5, 'G', 2),
      createGuitarString(4, 'D', 3),
      createGuitarString(3, 'G', 3),
      createGuitarString(2, 'B', 3),
      createGuitarString(1, 'D', 4),
    ],
  },
  {
    id: 'open-d',
    name: 'Open D',
    subtitle: 'D2 A2 D3 F#3 A3 D4',
    strings: [
      createGuitarString(6, 'D', 2),
      createGuitarString(5, 'A', 2),
      createGuitarString(4, 'D', 3),
      createGuitarString(3, 'F#', 3),
      createGuitarString(2, 'A', 3),
      createGuitarString(1, 'D', 4),
    ],
  },
  {
    id: 'dadgad',
    name: 'DADGAD',
    subtitle: 'D2 A2 D3 G3 A3 D4',
    strings: [
      createGuitarString(6, 'D', 2),
      createGuitarString(5, 'A', 2),
      createGuitarString(4, 'D', 3),
      createGuitarString(3, 'G', 3),
      createGuitarString(2, 'A', 3),
      createGuitarString(1, 'D', 4),
    ],
  },
];

export function formatStringsSubtitle(strings: GuitarString[]): string {
  return strings.map((s) => `${s.note}${s.octave}`).join(' ');
}

export function loadCustomTunings(): TuningPreset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_TUNINGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === 'string' && Array.isArray(item.strings) && item.strings.length === 6)
      .map((item) => {
        const normalizedStrings: GuitarString[] = item.strings.map(
          (s: { stringNumber: number; note: NoteName; octave: number }, idx: number) =>
            createGuitarString(s.stringNumber || 6 - idx, s.note, s.octave)
        );
        return {
          id: item.id,
          name: item.name,
          subtitle: formatStringsSubtitle(normalizedStrings),
          isCustom: true,
          strings: normalizedStrings,
        };
      });
  } catch {
    return [];
  }
}

export function saveCustomTunings(customTunings: TuningPreset[]): void {
  try {
    localStorage.setItem(CUSTOM_TUNINGS_KEY, JSON.stringify(customTunings));
  } catch {
    // Ignore storage quota errors in restricted environments
  }
}

export function getAllTunings(): TuningPreset[] {
  return [...BUILTIN_TUNING_PRESETS, ...loadCustomTunings()];
}

export function loadActiveTuningId(): string {
  try {
    const savedId = localStorage.getItem(ACTIVE_TUNING_ID_KEY);
    if (!savedId) return BUILTIN_TUNING_PRESETS[0].id;
    const all = getAllTunings();
    return all.some((t) => t.id === savedId) ? savedId : BUILTIN_TUNING_PRESETS[0].id;
  } catch {
    return BUILTIN_TUNING_PRESETS[0].id;
  }
}

export function saveActiveTuningId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_TUNING_ID_KEY, id);
  } catch {
    // Ignore storage errors
  }
}
