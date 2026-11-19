import * as alphaTab from '@coderline/alphatab';
import {
  NoteTechnique,
  STANDARD_OPEN_MIDI,
  SongScore,
  TabBeat,
  TabMeasure,
  TabNote,
  midiToLabel,
  parseCapoFromMarker,
} from '../types/tabs';

export interface AlphaTabTrackSummary {
  index: number;
  name: string;
  stringCount: number;
  tuningLabel: string;
  capo: number;
  isPercussion: boolean;
  measureCount: number;
}

export interface AlphaTabInspectionResult {
  title: string;
  artist: string;
  bpm: number;
  tracks: AlphaTabTrackSummary[];
}

/**
 * Извлекает 6 MIDI-значений открытых струн (от 6-й басовой к 1-й высокой) из Staff alphaTab.
 * В alphaTab массив staff.tuning обычно идет от 1-й (высокой) к 6-й (низкой).
 */
function extractOpenStringMidi(staff: alphaTab.model.Staff): number[] {
  const raw = staff.tuning;
  if (!raw || raw.length < 4) {
    return [...STANDARD_OPEN_MIDI];
  }

  const values = Array.from(raw);
  // Проверяем порядок: если первый элемент выше последнего (например E4=64 ... E2=40), переворачиваем к [6..1]
  const lowToHigh =
    values[0] > values[values.length - 1] ? [...values].reverse() : [...values];

  if (lowToHigh.length === 6) {
    return lowToHigh;
  }

  // Если 7-струнка или 4-струнка — аккуратно приводим к 6 струнам, сохраняя реальные ноты
  if (lowToHigh.length > 6) {
    return lowToHigh.slice(lowToHigh.length - 6);
  }
  const padded = [...STANDARD_OPEN_MIDI];
  for (let i = 0; i < lowToHigh.length; i++) {
    padded[i] = lowToHigh[i];
  }
  return padded;
}

function detectTuningName(openMidi: number[]): string {
  const key = openMidi.join(',');
  if (key === '40,45,50,55,59,64') return 'Standard';
  if (key === '38,45,50,55,59,64') return 'Drop D';
  if (key === '39,44,49,54,58,63') return 'Half-Step Down (Eb)';
  if (key === '38,43,48,53,57,62') return 'Full-Step Down (D)';
  if (key === '38,43,50,55,59,62') return 'Open G';
  if (key === '38,45,50,54,57,62') return 'Open D';
  if (key === '38,45,50,55,57,62') return 'DADGAD';
  return openMidi.map((m) => midiToLabel(m)).join(' ');
}

function durationToQuarterUnits(duration: alphaTab.model.Duration, dots = 0): number {
  let base = 1;
  switch (duration) {
    case alphaTab.model.Duration.QuadrupleWhole:
      base = 16;
      break;
    case alphaTab.model.Duration.DoubleWhole:
      base = 8;
      break;
    case alphaTab.model.Duration.Whole:
      base = 4;
      break;
    case alphaTab.model.Duration.Half:
      base = 2;
      break;
    case alphaTab.model.Duration.Quarter:
      base = 1;
      break;
    case alphaTab.model.Duration.Eighth:
      base = 0.5;
      break;
    case alphaTab.model.Duration.Sixteenth:
      base = 0.25;
      break;
    case alphaTab.model.Duration.ThirtySecond:
      base = 0.125;
      break;
    default:
      base = 1;
  }

  if (dots === 1) base *= 1.5;
  else if (dots >= 2) base *= 1.75;

  return Math.max(0.125, Math.round(base * 1000) / 1000);
}

function detectNoteTechnique(
  note: alphaTab.model.Note,
  beat: alphaTab.model.Beat
): NoteTechnique {
  const n = note as unknown as {
    isDead?: boolean;
    isGhost?: boolean;
    isHammerPullOrigin?: boolean;
    isHammerPullDestination?: boolean;
    slideOutType?: number;
    slideInType?: number;
    harmonicType?: number;
  };
  const b = beat as unknown as { slap?: boolean; pop?: boolean };

  if (b.slap || n.isDead) return 'slap';
  if (n.harmonicType && n.harmonicType !== 0) return 'harmonic';
  if (n.isGhost) return 'ghost';
  if (n.isHammerPullDestination || n.isHammerPullOrigin) return 'hammer';
  if ((n.slideOutType && n.slideOutType !== 0) || (n.slideInType && n.slideInType !== 0)) {
    return 'slide';
  }
  return 'normal';
}

/**
 * Headless-инспекция файла Guitar Pro (.gp/.gp3/.gp4/.gp5/.gpx) или MusicXML (.xml/.mxl)
 * без рендера DOM alphaTab — возвращает метаданные и список дорожек для выбора.
 */
export function inspectAlphaTabFile(bytes: Uint8Array): AlphaTabInspectionResult {
  const settings = new alphaTab.Settings();
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);

  const tracks: AlphaTabTrackSummary[] = score.tracks.map((track, idx) => {
    const primaryStaff = track.staves[0];
    const openMidi = primaryStaff
      ? extractOpenStringMidi(primaryStaff)
      : [...STANDARD_OPEN_MIDI];
    const isPercussion = Boolean(
      (primaryStaff as unknown as { isPercussion?: boolean })?.isPercussion
    );
    const capo = primaryStaff?.capo ?? 0;

    return {
      index: idx,
      name: track.name?.trim() || `Дорожка ${idx + 1}`,
      stringCount: primaryStaff?.tuning?.length || 6,
      tuningLabel: isPercussion ? 'Ударные / Перкуссия' : detectTuningName(openMidi),
      capo,
      isPercussion,
      measureCount: primaryStaff?.bars?.length || score.masterBars.length,
    };
  });

  return {
    title: score.title?.trim() || 'Без названия',
    artist: score.artist?.trim() || 'Неизвестный исполнитель',
    bpm: Math.max(30, Math.min(240, Math.round(score.tempo || 100))),
    tracks,
  };
}

/**
 * Конвертирует выбранную дорожку файла Guitar Pro / MusicXML в унифицированный SongScore
 */
export function extractAlphaTabTrack(
  bytes: Uint8Array,
  trackIndex: number,
  fallbackFileName = 'Импортированный таб'
): SongScore {
  const settings = new alphaTab.Settings();
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);

  const track = score.tracks[trackIndex] || score.tracks[0];
  if (!track || !track.staves[0]) {
    throw new Error('В выбранной дорожке не найдено гитарных тактов.');
  }

  const staff = track.staves[0];
  const openStringMidi = extractOpenStringMidi(staff);
  const tuningName = detectTuningName(openStringMidi);
  const initialCapo = Math.max(0, Math.min(12, staff.capo || 0));
  const baseBpm = Math.max(30, Math.min(240, Math.round(score.tempo || 100)));

  const measures: TabMeasure[] = [];

  staff.bars.forEach((bar, barIdx) => {
    const masterBar = score.masterBars[barIdx];
    const beats: TabBeat[] = [];

    const primaryVoice = bar.voices[0];
    if (primaryVoice && Array.isArray(primaryVoice.beats)) {
      primaryVoice.beats.forEach((beat, beatIdx) => {
        const duration = durationToQuarterUnits(beat.duration, beat.dots);

        if (beat.isRest || !beat.notes || beat.notes.length === 0) {
          // Если в самом бите указан слап без нот
          const beatAny = beat as unknown as { slap?: boolean };
          if (beatAny.slap) {
            beats.push({
              id: `gp-m${barIdx + 1}-b${beatIdx + 1}`,
              duration,
              notes: [{ string: 6, fret: -1, technique: 'slap' }],
            });
          } else {
            beats.push({
              id: `gp-m${barIdx + 1}-b${beatIdx + 1}`,
              duration,
              isRest: true,
              notes: [],
            });
          }
          return;
        }

        const tabNotes: TabNote[] = [];
        for (const note of beat.notes) {
          // Игнорируем лигованные ноты продолжения (tieDestination), чтобы не требовать повторного щипка
          if (note.isTieDestination) continue;

          // В alphaTab: note.string — 1-based от самой тонкой (1) к самой толстой (6),
          // либо инвертированный индекс в зависимости от формата: приводим безопасно к 1..6.
          const totalStrings = Math.max(6, staff.tuning?.length || 6);
          const rawString = note.string || 1;
          const mappedString = Math.max(
            1,
            Math.min(6, totalStrings - rawString + 1)
          );
          const technique = detectNoteTechnique(note, beat);

          tabNotes.push({
            string: mappedString,
            fret: technique === 'slap' ? -1 : Math.max(0, note.fret || 0),
            technique,
          });
        }

        if (tabNotes.length > 0) {
          beats.push({
            id: `gp-m${barIdx + 1}-b${beatIdx + 1}`,
            duration,
            notes: tabNotes,
          });
        }
      });
    }

    // Собираем текстовые пометки такта (секции и текст битов)
    const sectionText = masterBar?.section?.text?.trim();
    let beatText = '';
    if (primaryVoice?.beats) {
      for (const b of primaryVoice.beats) {
        if (b.text && b.text.trim()) {
          beatText = b.text.trim();
          break;
        }
      }
    }
    const marker = beatText || sectionText || undefined;
    const capoChange = parseCapoFromMarker(marker);

    // Смена темпа на такте
    let tempoOverride: number | undefined;
    const masterAny = masterBar as unknown as {
      tempoAutomations?: Array<{ value: number }>;
    };
    if (masterAny?.tempoAutomations && masterAny.tempoAutomations.length > 0) {
      const val = Math.round(masterAny.tempoAutomations[0].value);
      if (val >= 30 && val <= 240) {
        tempoOverride = val;
      }
    }

    if (beats.length > 0) {
      measures.push({
        index: barIdx + 1,
        timeSignature: masterBar
          ? {
              beats: masterBar.timeSignatureNumerator || 4,
              value: masterBar.timeSignatureDenominator || 4,
            }
          : { beats: 4, value: 4 },
        tempoOverride,
        capoChange,
        marker,
        beats,
      });
    }
  });

  if (measures.length === 0) {
    throw new Error('В выбранной дорожке нет распознаваемых нот для обучения.');
  }

  const cleanFileName = fallbackFileName.replace(/\.(gp|gp3|gp4|gp5|gpx|xml|mxl)$/i, '');

  return {
    id: `song-gp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: score.title?.trim() || cleanFileName,
    artist: score.artist?.trim() || track.name?.trim() || 'Guitar Pro',
    bpm: baseBpm,
    tuning: {
      name: tuningName,
      openStringMidi,
    },
    capo: initialCapo,
    measures,
    source: 'alphatab',
    createdAt: Date.now(),
  };
}
