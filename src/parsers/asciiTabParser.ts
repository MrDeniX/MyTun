import {
  NoteTechnique,
  STANDARD_OPEN_MIDI,
  SongScore,
  SongTuning,
  TabBeat,
  TabMeasure,
  TabNote,
  parseCapoFromMarker,
} from '../types/tabs';

export interface AsciiParseOptions {
  title: string;
  artist?: string;
  bpm: number;
  tuning: SongTuning;
  capo: number;
}

interface ParsedToken {
  string: number; // 1 (high e) .. 6 (low E)
  col: number;
  fret: number;
  technique: NoteTechnique;
}

const TAB_LINE_REGEX = /^\s*([A-Ga-g][#b]?\d?)?\s*\|([-0-9hHpP/\\xX<>()~|bBsStT\s]+)\|?\s*$/;

/**
 * Разбирает классические текстовые ASCII-табулатуры (поддерживает 1- и 2-значные лады,
 * аккорды, техники h/p/slide/x/<12>/(ghost), тактовые черты | и текстовые пометки вроде "Move capo to 1st fret").
 */
export function parseAsciiTab(
  rawText: string,
  options: AsciiParseOptions
): SongScore {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');

  // Группируем последовательные блоки по 6 струн + запоминаем текстовые маркеры над блоками
  const blocks: Array<{ lines: string[]; marker?: string }> = [];
  let currentBlock: string[] = [];
  let pendingMarker: string | undefined;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (currentBlock.length === 6) {
        blocks.push({ lines: currentBlock, marker: pendingMarker });
        currentBlock = [];
        pendingMarker = undefined;
      }
      continue;
    }

    if (TAB_LINE_REGEX.test(rawLine) || (trimmed.includes('|') && trimmed.includes('-'))) {
      const pipeIdx = rawLine.indexOf('|');
      const content = pipeIdx >= 0 ? rawLine.slice(pipeIdx + 1) : rawLine;
      currentBlock.push(content);
      if (currentBlock.length === 6) {
        blocks.push({ lines: currentBlock, marker: pendingMarker });
        currentBlock = [];
        pendingMarker = undefined;
      }
    } else if (currentBlock.length === 0) {
      // Сохраняем текстовую строку над блоком как маркер (например, "Move capo to 1st fret")
      if (trimmed.length <= 64) {
        pendingMarker = trimmed;
      }
    }
  }

  if (currentBlock.length === 6) {
    blocks.push({ lines: currentBlock, marker: pendingMarker });
  }

  if (blocks.length === 0) {
    throw new Error(
      'Не удалось найти 6-струнный блок табулатуры. Убедитесь, что вставлены 6 строк формата e|---0---|.'
    );
  }

  const measures: TabMeasure[] = [];
  let measureCounter = 1;

  for (const block of blocks) {
    // Разрезаем блок на такты по вертикальным чертам `|`
    const splitLines = block.lines.map((line) =>
      line
        .replace(/\|+$/, '')
        .split('|')
        .map((seg) => seg)
    );

    const maxSegments = Math.max(...splitLines.map((segs) => segs.length));

    for (let segIdx = 0; segIdx < maxSegments; segIdx++) {
      const segmentLines = splitLines.map((segs) => segs[segIdx] || '');
      const tokens = extractTokensFromSegment(segmentLines);

      if (tokens.length === 0) continue;

      // Группируем ноты по столбцу (допуск ±1 символ для двузначных ладов в аккорде)
      tokens.sort((a, b) => a.col - b.col);
      const groups: ParsedToken[][] = [];

      for (const token of tokens) {
        const lastGroup = groups[groups.length - 1];
        if (
          lastGroup &&
          Math.abs(token.col - lastGroup[0].col) <= 1 &&
          !lastGroup.some((existing) => existing.string === token.string)
        ) {
          lastGroup.push(token);
        } else {
          groups.push([token]);
        }
      }

      const beats: TabBeat[] = groups.map((group, bIdx) => {
        const notes: TabNote[] = group
          .sort((a, b) => b.string - a.string)
          .map((t) => ({
            string: t.string,
            fret: t.fret,
            technique: t.technique,
          }));

        return {
          id: `ascii-m${measureCounter}-b${bIdx + 1}`,
          duration: groups.length >= 6 ? 0.5 : 1,
          notes,
        };
      });

      const marker = segIdx === 0 ? block.marker : undefined;
      const capoChange = parseCapoFromMarker(marker);

      measures.push({
        index: measureCounter,
        timeSignature: { beats: 4, value: 4 },
        marker,
        capoChange,
        beats,
      });
      measureCounter++;
    }
  }

  if (measures.length === 0) {
    throw new Error('В табулатуре не обнаружено цифр ладов или символов X.');
  }

  return {
    id: `song-ascii-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: options.title.trim() || 'Текстовый таб',
    artist: options.artist?.trim() || 'ASCII Import',
    bpm: Math.max(30, Math.min(240, Math.round(options.bpm || 100))),
    tuning:
      options.tuning.openStringMidi.length === 6
        ? options.tuning
        : { name: 'Standard', openStringMidi: [...STANDARD_OPEN_MIDI] },
    capo: Math.max(0, Math.min(12, Math.round(options.capo || 0))),
    measures,
    source: 'ascii',
    createdAt: Date.now(),
  };
}

function extractTokensFromSegment(segmentLines: string[]): ParsedToken[] {
  const tokens: ParsedToken[] = [];

  // lineIdx 0 -> 1-я струна (тонкая e), lineIdx 5 -> 6-я струна (басовая E)
  for (let lineIdx = 0; lineIdx < 6; lineIdx++) {
    const line = segmentLines[lineIdx] || '';
    const stringNum = lineIdx + 1;
    let i = 0;

    while (i < line.length) {
      const ch = line[i];

      // Флажолет <12>
      if (ch === '<') {
        const match = line.slice(i).match(/^<(\d{1,2})>/);
        if (match) {
          tokens.push({
            string: stringNum,
            col: i,
            fret: parseInt(match[1], 10),
            technique: 'harmonic',
          });
          i += match[0].length;
          continue;
        }
      }

      // Призрачная нота (5)
      if (ch === '(') {
        const match = line.slice(i).match(/^\((\d{1,2})\)/);
        if (match) {
          tokens.push({
            string: stringNum,
            col: i,
            fret: parseInt(match[1], 10),
            technique: 'ghost',
          });
          i += match[0].length;
          continue;
        }
      }

      // Перкуссионный слап / глушение X
      if (ch === 'x' || ch === 'X') {
        tokens.push({
          string: stringNum,
          col: i,
          fret: -1,
          technique: 'slap',
        });
        i++;
        continue;
      }

      // Цифры лада (1 или 2 цифры)
      if (ch >= '0' && ch <= '9') {
        let numStr = ch;
        if (i + 1 < line.length && line[i + 1] >= '0' && line[i + 1] <= '9') {
          numStr += line[i + 1];
        }
        const fret = parseInt(numStr, 10);

        // Проверяем символ техники слева (h, p, /, \)
        const prevChar = i > 0 ? line[i - 1] : '';
        let technique: NoteTechnique = 'normal';
        if (prevChar === 'h' || prevChar === 'H' || prevChar === 'p' || prevChar === 'P') {
          technique = 'hammer';
        } else if (prevChar === '/' || prevChar === '\\' || prevChar === 's' || prevChar === 'S') {
          technique = 'slide';
        }

        tokens.push({
          string: stringNum,
          col: i,
          fret,
          technique,
        });
        i += numStr.length;
        continue;
      }

      i++;
    }
  }

  return tokens;
}

export const SAMPLE_ASCII_TAB = `Intro · Acoustic Riff
e|---0-----2h3-----0---|---<12>-----3/5---0---|
B|---0---------0---1---|-----0------3-----1---|
G|---0-------------0---|-----0------------0---|
D|---2---------x---2---|-----2------x-----2---|
A|---2---------x---3---|-----2------x-----3---|
E|---0---------x-------|-----0------x---------|

Move capo to 2nd fret
e|---0---2---3---0---|
B|---1---3---3---0---|
G|---2---2---0---0---|
D|---2---0---0---2---|
A|---0-------2---2---|
E|-----------3---0---|`;
