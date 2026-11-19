import React, { useEffect, useMemo, useRef } from 'react';
import {
  BeatEvaluationStatus,
  FlatBeatPointer,
  SongScore,
  midiToNoteParts,
} from '../types/tabs';

interface TabCanvasRendererProps {
  song: SongScore;
  flatBeats: FlatBeatPointer[];
  activeFlatIndex: number;
  beatStatuses: Record<number, BeatEvaluationStatus>;
  loopEnabled: boolean;
  loopStartMeasure: number;
  loopEndMeasure: number;
  onSelectBeat: (flatIndex: number) => void;
}

const STRING_SPACING = 28;
const TOP_PADDING = 46;
const BOTTOM_PADDING = 26;
const LEFT_GUTTER = 16;
const MEASURE_START_PAD = 22;
const BEAT_BASE_WIDTH = 54;

interface BeatLayoutItem {
  pointer: FlatBeatPointer;
  x: number;
  width: number;
}

interface MeasureLayoutItem {
  measureNumber: number;
  startX: number;
  endX: number;
  marker?: string;
  capoChange?: number;
  tempoOverride?: number;
  inLoop: boolean;
}

export const TabCanvasRenderer: React.FC<TabCanvasRendererProps> = React.memo(({
  song,
  flatBeats,
  activeFlatIndex,
  beatStatuses,
  loopEnabled,
  loopStartMeasure,
  loopEndMeasure,
  onSelectBeat,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Метки 6 открытых струн сверху вниз: 1-я (высокая) .. 6-я (басовая)
  const stringLabels = useMemo(() => {
    const midis = song.tuning.openStringMidi;
    const labels: string[] = [];
    // stringNum 1 -> index 5, stringNum 6 -> index 0
    for (let s = 1; s <= 6; s++) {
      const midi = midis[6 - s] ?? 40;
      const { note } = midiToNoteParts(midi);
      labels.push(s === 1 ? note.toLowerCase() : note);
    }
    return labels;
  }, [song.tuning.openStringMidi]);

  // Вычисляем X-координаты всех тактов и долей
  const { beatLayouts, measureLayouts, totalWidth } = useMemo(() => {
    const bLayouts: BeatLayoutItem[] = [];
    const mLayouts: MeasureLayoutItem[] = [];

    let cursorX = LEFT_GUTTER;
    let currentMeasureStartX = cursorX;
    let prevMeasureNum: number | null = null;

    flatBeats.forEach((ptr, idx) => {
      const isNewMeasure = prevMeasureNum !== ptr.measureNumber;
      if (isNewMeasure) {
        if (prevMeasureNum !== null) {
          cursorX += 16;
          const prevMeasure = song.measures.find((m) => m.index === prevMeasureNum);
          mLayouts.push({
            measureNumber: prevMeasureNum,
            startX: currentMeasureStartX,
            endX: cursorX,
            marker: prevMeasure?.marker,
            capoChange: prevMeasure?.capoChange,
            tempoOverride: prevMeasure?.tempoOverride,
            inLoop:
              loopEnabled &&
              prevMeasureNum >= loopStartMeasure &&
              prevMeasureNum <= loopEndMeasure,
          });
          currentMeasureStartX = cursorX;
        }
        cursorX += MEASURE_START_PAD;
        prevMeasureNum = ptr.measureNumber;
      }

      const beatWidth = Math.max(
        46,
        Math.min(92, Math.round(BEAT_BASE_WIDTH * Math.max(0.75, Math.min(1.6, ptr.beat.duration))))
      );

      bLayouts.push({
        pointer: ptr,
        x: cursorX + beatWidth * 0.45,
        width: beatWidth,
      });

      cursorX += beatWidth;

      if (idx === flatBeats.length - 1 && prevMeasureNum !== null) {
        cursorX += 16;
        const lastMeasure = song.measures.find((m) => m.index === prevMeasureNum);
        mLayouts.push({
          measureNumber: prevMeasureNum,
          startX: currentMeasureStartX,
          endX: cursorX,
          marker: lastMeasure?.marker,
          capoChange: lastMeasure?.capoChange,
          tempoOverride: lastMeasure?.tempoOverride,
          inLoop:
            loopEnabled &&
            prevMeasureNum >= loopStartMeasure &&
            prevMeasureNum <= loopEndMeasure,
        });
      }
    });

    return {
      beatLayouts: bLayouts,
      measureLayouts: mLayouts,
      totalWidth: Math.max(360, cursorX + 40),
    };
  }, [flatBeats, song.measures, loopEnabled, loopStartMeasure, loopEndMeasure]);

  const svgHeight = TOP_PADDING + 5 * STRING_SPACING + BOTTOM_PADDING;
  const activeLayout = beatLayouts[activeFlatIndex];

  // Плавный горизонтальный автоскролл, удерживающий курсор в удобной зоне обзора (~35% ширины)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !activeLayout) return;

    const targetScrollLeft = Math.max(
      0,
      activeLayout.x - container.clientWidth * 0.35
    );
    container.scrollTo({
      left: targetScrollLeft,
      behavior: 'smooth',
    });
  }, [activeFlatIndex, activeLayout]);

  const getStringY = (stringNumber: number) =>
    TOP_PADDING + (Math.max(1, Math.min(6, stringNumber)) - 1) * STRING_SPACING;

  const getNoteColors = (
    status: BeatEvaluationStatus | undefined,
    isActive: boolean,
    isGhost: boolean
  ): { fill: string; bgFill: string; stroke: string } => {
    if (status === 'hit') {
      return {
        fill: '#0A0A0A',
        bgFill: '#10B981',
        stroke: '#10B981',
      };
    }
    if (status === 'wrong') {
      return {
        fill: '#FAFAFA',
        bgFill: '#EF4444',
        stroke: '#EF4444',
      };
    }
    if (status === 'missed' || status === 'skipped') {
      return {
        fill: '#71717A',
        bgFill: '#141414',
        stroke: '#27272A',
      };
    }
    if (isActive) {
      return {
        fill: '#0A0A0A',
        bgFill: '#FAFAFA',
        stroke: '#10B981',
      };
    }
    return {
      fill: isGhost ? '#71717A' : '#FAFAFA',
      bgFill: '#0A0A0A',
      stroke: 'transparent',
    };
  };

  return (
    <div
      className="relative rounded-2xl bg-[#0A0A0A] border border-[#262626] overflow-hidden flex shrink-0"
      style={{ minHeight: svgHeight }}
    >
      {/* Фиксированная левая колонка обозначений струн */}
      <div
        className="w-10 shrink-0 bg-[#141414] border-r border-[#262626] relative z-10 select-none"
        style={{ height: svgHeight }}
      >
        <div className="absolute top-3 left-0 right-0 text-center font-mono text-[10px] font-semibold text-[#52525B]">
          TAB
        </div>
        {stringLabels.map((label, idx) => (
          <div
            key={idx}
            className="absolute left-0 right-0 flex items-center justify-center font-mono text-xs font-semibold text-[#8E8E93]"
            style={{
              top: TOP_PADDING + idx * STRING_SPACING - 9,
              height: 18,
            }}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Прокручиваемый SVG-холст табулатуры */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-x-auto overflow-y-hidden scroll-smooth"
      >
        <svg
          width={totalWidth}
          height={svgHeight}
          viewBox={`0 0 ${totalWidth} ${svgHeight}`}
          className="block select-none"
        >
          {/* Подсветка зоны петли A-B Loop */}
          {measureLayouts
            .filter((m) => m.inLoop)
            .map((m) => (
              <rect
                key={`loop-${m.measureNumber}`}
                x={m.startX}
                y={TOP_PADDING - 14}
                width={m.endX - m.startX}
                height={5 * STRING_SPACING + 28}
                fill="#10B981"
                fillOpacity={0.07}
              />
            ))}

          {/* 6 горизонтальных линий струн */}
          {[1, 2, 3, 4, 5, 6].map((stringNum) => {
            const y = getStringY(stringNum);
            return (
              <line
                key={`string-${stringNum}`}
                x1={0}
                y1={y}
                x2={totalWidth}
                y2={y}
                stroke="#262626"
                strokeWidth={stringNum >= 5 ? 1.5 : 1}
              />
            );
          })}

          {/* Тактовые черты, номера тактов и текстовые маркеры (каподастр / темп / секции) */}
          {measureLayouts.map((m) => (
            <g key={`measure-${m.measureNumber}`}>
              {/* Вертикальная тактовая черта в начале такта */}
              <line
                x1={m.startX}
                y1={TOP_PADDING}
                x2={m.startX}
                y2={TOP_PADDING + 5 * STRING_SPACING}
                stroke={m.inLoop ? '#10B981' : '#3F3F46'}
                strokeWidth={m.measureNumber === 1 ? 2 : 1.25}
              />
              {/* Закрывающая черта в конце такта */}
              <line
                x1={m.endX}
                y1={TOP_PADDING}
                x2={m.endX}
                y2={TOP_PADDING + 5 * STRING_SPACING}
                stroke={m.inLoop ? '#10B981' : '#3F3F46'}
                strokeWidth={1.25}
              />
              {/* Номер такта */}
              <text
                x={m.startX + 6}
                y={TOP_PADDING - 18}
                fill={m.inLoop ? '#10B981' : '#52525B'}
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
                fontWeight="600"
              >
                {m.measureNumber}
              </text>

              {/* Текстовый маркер или смена каподастра над тактом */}
              {(m.marker || typeof m.capoChange === 'number' || m.tempoOverride) && (
                <text
                  x={m.startX + 26}
                  y={TOP_PADDING - 18}
                  fill={typeof m.capoChange === 'number' ? '#F59E0B' : '#A1A1AA'}
                  fontSize="10.5"
                  fontFamily="Plus Jakarta Sans, sans-serif"
                  fontWeight={typeof m.capoChange === 'number' ? '600' : '500'}
                >
                  {m.marker ||
                    (typeof m.capoChange === 'number'
                      ? `Капо ${m.capoChange} лад`
                      : `♩=${m.tempoOverride}`)}
                </text>
              )}
            </g>
          ))}

          {/* Вертикальный курсор (Playhead) текущего бита */}
          {activeLayout && (
            <g>
              <rect
                x={activeLayout.x - 16}
                y={TOP_PADDING - 12}
                width={32}
                height={5 * STRING_SPACING + 24}
                rx={10}
                fill="#10B981"
                fillOpacity={0.11}
              />
              <line
                x1={activeLayout.x}
                y1={TOP_PADDING - 14}
                x2={activeLayout.x}
                y2={TOP_PADDING + 5 * STRING_SPACING + 14}
                stroke="#10B981"
                strokeWidth={2}
                strokeDasharray="3 3"
              />
              <circle
                cx={activeLayout.x}
                cy={TOP_PADDING - 14}
                r={3.5}
                fill="#10B981"
              />
            </g>
          )}

          {/* Ноты, техники (дуги hammer-on/pull-off, линии slide, X слапы, <12> флажолеты) */}
          {beatLayouts.map((item, idx) => {
            const { pointer, x } = item;
            const isActive = idx === activeFlatIndex;
            const status = beatStatuses[idx];
            const prevItem = idx > 0 ? beatLayouts[idx - 1] : null;

            return (
              <g
                key={pointer.beat.id}
                onClick={() => onSelectBeat(idx)}
                className="cursor-pointer"
              >
                {/* Невидимая зона клика для удобного тапа пальцем по любому биту */}
                <rect
                  x={x - item.width * 0.45}
                  y={TOP_PADDING - 10}
                  width={item.width * 0.9}
                  height={5 * STRING_SPACING + 20}
                  fill="transparent"
                />

                {/* Пауза */}
                {pointer.beat.isRest || pointer.beat.notes.length === 0 ? (
                  <text
                    x={x}
                    y={TOP_PADDING + 2.5 * STRING_SPACING + 4}
                    textAnchor="middle"
                    fill="#3F3F46"
                    fontSize="13"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    —
                  </text>
                ) : (
                  pointer.beat.notes.map((note, nIdx) => {
                    const y = getStringY(note.string);
                    const colors = getNoteColors(
                      status,
                      isActive,
                      note.technique === 'ghost'
                    );

                    // Форматируем отображение лада и техники
                    let label = String(note.fret);
                    if (note.technique === 'slap' || note.fret < 0) {
                      label = 'X';
                    } else if (note.technique === 'harmonic') {
                      label = `<${note.fret}>`;
                    } else if (note.technique === 'ghost') {
                      label = `(${note.fret})`;
                    }

                    const boxWidth =
                      label.length >= 4
                        ? 34
                        : label.length === 3
                        ? 28
                        : label.length === 2
                        ? 24
                        : 20;

                    // Проверяем, есть ли предыдущая нота на той же струне для дуги hammer/slide
                    const prevSameString = prevItem?.pointer.beat.notes.find(
                      (pn) => pn.string === note.string
                    );

                    return (
                      <g key={`${pointer.beat.id}-n${nIdx}`}>
                        {/* Дуга для Hammer-on / Pull-off */}
                        {note.technique === 'hammer' && prevItem && prevSameString && (
                          <path
                            d={`M ${prevItem.x + 8} ${y - 9} Q ${(prevItem.x + x) / 2} ${y - 22} ${x - 8} ${y - 9}`}
                            fill="none"
                            stroke={status === 'hit' ? '#10B981' : '#8E8E93'}
                            strokeWidth={1.3}
                          />
                        )}

                        {/* Диагональная линия для Slide */}
                        {note.technique === 'slide' && prevItem && prevSameString && (
                          <line
                            x1={prevItem.x + 11}
                            y1={y + 5}
                            x2={x - 11}
                            y2={y - 5}
                            stroke={status === 'hit' ? '#10B981' : '#8E8E93'}
                            strokeWidth={1.5}
                          />
                        )}

                        {/* Подложка цифры (маскирует линию струны и показывает статус) */}
                        <rect
                          x={x - boxWidth / 2}
                          y={y - 10}
                          width={boxWidth}
                          height={20}
                          rx={6}
                          fill={colors.bgFill}
                          stroke={colors.stroke}
                          strokeWidth={isActive ? 1.5 : 1}
                        />

                        {/* Цифра лада / X / <12> */}
                        <text
                          x={x}
                          y={y + 4.5}
                          textAnchor="middle"
                          fill={
                            note.technique === 'slap' && !status && !isActive
                              ? '#F59E0B'
                              : note.technique === 'harmonic' && !status && !isActive
                              ? '#38BDF8'
                              : colors.fill
                          }
                          fontSize={label.length >= 3 ? '10.5' : '12.5'}
                          fontFamily="JetBrains Mono, monospace"
                          fontWeight="700"
                        >
                          {label}
                        </text>
                      </g>
                    );
                  })
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
});

TabCanvasRenderer.displayName = 'TabCanvasRenderer';
