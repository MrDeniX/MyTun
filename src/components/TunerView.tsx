import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronRight,
  Lock,
  Mic,
  MicOff,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { TunerEngine, TunerFrameData } from '../audio/tunerEngine';
import {
  GuitarString,
  REFERENCE_A4,
  TuningPreset,
  calculateCentsDeviation,
} from '../types/tuning';

interface TunerViewProps {
  activePreset: TuningPreset;
  isVisible: boolean;
  onOpenPresetDrawer: () => void;
  isListening: boolean;
  onListeningChange: (listening: boolean) => void;
}

const SCALE_TICKS = [-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50];

export const TunerView: React.FC<TunerViewProps> = ({
  activePreset,
  isVisible,
  onOpenPresetDrawer,
  isListening,
  onListeningChange,
}) => {
  const engineRef = useRef<TunerEngine | null>(null);
  const lastVibrateTimeRef = useRef<number>(0);
  const lastFramePushRef = useRef<number>(0);
  const isListeningRef = useRef(isListening);
  isListeningRef.current = isListening;

  const [lockedStringIdx, setLockedStringIdx] = useState<number | null>(null);
  const [frameData, setFrameData] = useState<TunerFrameData>({
    frequency: null,
    rms: 0,
    probability: 0,
  });
  const [micError, setMicError] = useState<string | null>(null);
  const [playingRefStringIdx, setPlayingRefStringIdx] = useState<number | null>(null);
  const [showGateModal, setShowGateModal] = useState(false);
  const [noiseGateSensitivity, setNoiseGateSensitivity] = useState(0.0075);

  useEffect(() => {
    setLockedStringIdx(null);
  }, [activePreset.id]);

  // Автоматически освобождаем микрофон при переходе на другую вкладку
  useEffect(() => {
    if (!isVisible && isListeningRef.current && engineRef.current) {
      engineRef.current.stop();
      onListeningChange(false);
      setFrameData({ frequency: null, rms: 0, probability: 0 });
    }
  }, [isVisible, onListeningChange]);

  useEffect(() => {
    const engine = new TunerEngine();
    engine.setCallback((data) => {
      const now = performance.now();
      // Троттлинг обновлений React до ~25 FPS для снижения нагрузки на батарею телефона
      if (now - lastFramePushRef.current >= 38 || data.frequency === null) {
        lastFramePushRef.current = now;
        setFrameData(data);
      }
    });
    engineRef.current = engine;

    return () => {
      engine.stop();
      engine.stopReferenceTone();
      onListeningChange(false);
    };
  }, [onListeningChange]);

  const targetStringInfo = useMemo((): {
    stringObj: GuitarString;
    index: number;
    cents: number | null;
    isInTune: boolean;
  } => {
    const strings = activePreset.strings;

    if (lockedStringIdx !== null && strings[lockedStringIdx]) {
      const target = strings[lockedStringIdx];
      if (frameData.frequency === null) {
        return {
          stringObj: target,
          index: lockedStringIdx,
          cents: null,
          isInTune: false,
        };
      }
      const cents = calculateCentsDeviation(frameData.frequency, target.frequency);
      return {
        stringObj: target,
        index: lockedStringIdx,
        cents,
        isInTune: Math.abs(cents) <= 4,
      };
    }

    if (frameData.frequency === null) {
      return {
        stringObj: strings[0],
        index: 0,
        cents: null,
        isInTune: false,
      };
    }

    let bestIndex = 0;
    let minAbsCents = Infinity;
    for (let i = 0; i < strings.length; i++) {
      const rawCents = Math.abs(
        1200 * Math.log2(frameData.frequency / strings[i].frequency)
      );
      if (rawCents < minAbsCents) {
        minAbsCents = rawCents;
        bestIndex = i;
      }
    }

    const bestString = strings[bestIndex];
    const cents = calculateCentsDeviation(frameData.frequency, bestString.frequency);
    return {
      stringObj: bestString,
      index: bestIndex,
      cents,
      isInTune: Math.abs(cents) <= 4,
    };
  }, [activePreset.strings, lockedStringIdx, frameData.frequency]);

  useEffect(() => {
    if (
      isListening &&
      frameData.frequency !== null &&
      targetStringInfo.isInTune &&
      typeof navigator !== 'undefined' &&
      'vibrate' in navigator
    ) {
      const now = Date.now();
      if (now - lastVibrateTimeRef.current > 1400) {
        try {
          navigator.vibrate(15);
        } catch {
          // ignore
        }
        lastVibrateTimeRef.current = now;
      }
    }
  }, [isListening, frameData.frequency, targetStringInfo.isInTune]);

  const handleToggleMic = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;

    if (isListening) {
      engine.stop();
      onListeningChange(false);
      setFrameData({ frequency: null, rms: 0, probability: 0 });
      return;
    }

    setMicError(null);
    engine.stopReferenceTone();
    setPlayingRefStringIdx(null);

    try {
      await engine.start();
      onListeningChange(true);
    } catch (err) {
      onListeningChange(false);
      const message =
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Доступ к микрофону запрещен. Разрешите доступ в настройках браузера.'
          : 'Не удалось подключить микрофон. Проверьте подключение аудиоустройства.';
      setMicError(message);
    }
  }, [isListening, onListeningChange]);

  const handleSelectString = (idx: number) => {
    setLockedStringIdx((prev) => (prev === idx ? null : idx));
  };

  const handleToggleReferenceTone = async () => {
    const engine = engineRef.current;
    if (!engine) return;

    const targetIdx =
      lockedStringIdx !== null ? lockedStringIdx : targetStringInfo.index;

    if (playingRefStringIdx === targetIdx) {
      engine.stopReferenceTone();
      setPlayingRefStringIdx(null);
      return;
    }

    const targetString = activePreset.strings[targetIdx];
    if (!targetString) return;

    setPlayingRefStringIdx(targetIdx);
    await engine.playReferenceTone(targetString.frequency, () => {
      setPlayingRefStringIdx(null);
    });
  };

  const handleGateChange = (val: number) => {
    setNoiseGateSensitivity(val);
    engineRef.current?.setNoiseGateThreshold(val);
  };

  const hasSignal =
    isListening && frameData.frequency !== null && targetStringInfo.cents !== null;
  const absCents =
    targetStringInfo.cents !== null ? Math.abs(targetStringInfo.cents) : 0;

  let statusColorText = 'text-[#52525B]';
  let statusColorBg = 'bg-[#52525B]';
  let statusBorder = 'border-[#262626]';
  let tuningHint = isListening ? 'Извлеките звук струны' : 'Микрофон выключен';

  if (hasSignal) {
    if (absCents <= 4) {
      statusColorText = 'text-[#10B981]';
      statusColorBg = 'bg-[#10B981]';
      statusBorder = 'border-[#10B981]/60';
      tuningHint = 'Точная настройка (±4 ct)';
    } else if (absCents <= 15) {
      statusColorText = 'text-[#F59E0B]';
      statusColorBg = 'bg-[#F59E0B]';
      statusBorder = 'border-[#F59E0B]/50';
      tuningHint =
        (targetStringInfo.cents ?? 0) < 0
          ? 'Ниже ноты · Подтяните'
          : 'Выше ноты · Ослабьте';
    } else {
      statusColorText = 'text-[#EF4444]';
      statusColorBg = 'bg-[#EF4444]';
      statusBorder = 'border-[#EF4444]/50';
      tuningHint =
        (targetStringInfo.cents ?? 0) < 0
          ? 'Сильно ниже · Подтяните'
          : 'Сильно выше · Ослабьте';
    }
  }

  const indicatorPercent =
    hasSignal && targetStringInfo.cents !== null
      ? Math.max(0, Math.min(100, ((targetStringInfo.cents + 50) / 100) * 100))
      : 50;

  return (
    <div className="flex flex-col gap-4 w-full max-w-4xl mx-auto">
      {/* 1. Верхняя строка: Выбор строя + Авто/Ручной + Noise Gate */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenPresetDrawer}
          className="flex-1 min-w-0 min-h-[48px] px-3.5 py-2 rounded-2xl bg-[#141414] border border-[#262626] hover:border-[#3F3F46] active:scale-[0.99] transition-all flex items-center justify-between text-left cursor-pointer"
        >
          <div className="min-w-0 pr-1.5">
            <div className="flex items-center gap-1.5 text-[11px] text-[#8E8E93]">
              <span className="truncate font-semibold text-[#FAFAFA]">
                {activePreset.name}
              </span>
              <span>·</span>
              <span className="font-mono tabular-nums text-[#10B981] shrink-0">
                {REFERENCE_A4} Гц
              </span>
            </div>
            <div className="text-[11px] font-mono tabular-nums text-[#8E8E93] truncate mt-0.5">
              {activePreset.subtitle}
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-[#8E8E93] shrink-0" />
        </button>

        <button
          type="button"
          onClick={() => setLockedStringIdx(null)}
          className={`min-h-[48px] px-3 rounded-2xl border text-xs font-medium transition-all flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer shrink-0 ${
            lockedStringIdx === null
              ? 'bg-[#10B981]/12 border-[#10B981] text-[#10B981]'
              : 'bg-[#141414] border-[#262626] text-[#F59E0B]'
          }`}
        >
          {lockedStringIdx === null ? (
            <>
              <Sparkles className="w-3.5 h-3.5" />
              <span>Авто</span>
            </>
          ) : (
            <>
              <Lock className="w-3.5 h-3.5" />
              <span>Сброс</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={() => setShowGateModal(true)}
          className="min-h-[48px] min-w-[48px] rounded-2xl bg-[#141414] border border-[#262626] hover:border-[#3F3F46] flex items-center justify-center text-[#8E8E93] hover:text-[#FAFAFA] transition-colors cursor-pointer shrink-0"
          title="Порог шумоподавления (Noise Gate)"
          aria-label="Порог шумоподавления"
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>
      </div>

      {/* 2. Главный приборный дисплей (свободная просторная высота без сжатия) */}
      <div
        className={`relative rounded-3xl bg-[#141414] border ${statusBorder} px-5 py-6 sm:p-8 flex flex-col gap-6 transition-colors duration-150`}
      >
        <div className="flex items-center justify-between text-xs text-[#8E8E93]">
          <div className="flex items-center gap-1.5 font-mono tabular-nums">
            <span>Струна {targetStringInfo.stringObj.stringNumber}</span>
            <span aria-hidden="true">·</span>
            <span>{targetStringInfo.stringObj.frequency.toFixed(1)} Гц</span>
          </div>
          <div className="font-mono tabular-nums">
            {hasSignal && targetStringInfo.cents !== null ? (
              <span className={`font-semibold ${statusColorText}`}>
                {targetStringInfo.cents > 0
                  ? `+${targetStringInfo.cents} ct`
                  : `${targetStringInfo.cents} ct`}
              </span>
            ) : (
              <span className="text-[#52525B]">0 ct</span>
            )}
          </div>
        </div>

        {/* Центральный блок: Крупная нота и частота */}
        <div className="flex flex-col items-center justify-center text-center py-2">
          <div className="flex items-baseline justify-center">
            <span
              className={`font-mono tabular-nums text-7xl sm:text-8xl font-bold tracking-tight leading-none transition-colors duration-150 ${
                hasSignal ? statusColorText : 'text-[#FAFAFA]'
              }`}
            >
              {targetStringInfo.stringObj.note}
            </span>
            <span
              className={`font-mono tabular-nums text-2xl sm:text-4xl font-semibold ml-1 ${
                hasSignal ? statusColorText : 'text-[#8E8E93]'
              }`}
            >
              {targetStringInfo.stringObj.octave}
            </span>
          </div>

          <div className="mt-2 flex items-center gap-2 font-mono tabular-nums text-xs sm:text-sm">
            <span className={hasSignal ? 'text-[#FAFAFA]' : 'text-[#52525B]'}>
              {hasSignal && frameData.frequency !== null
                ? `${frameData.frequency.toFixed(1)} Гц`
                : `${targetStringInfo.stringObj.frequency.toFixed(1)} Гц`}
            </span>
            <span className="text-[#262626]">|</span>
            <span
              className={`font-sans font-medium ${
                hasSignal ? statusColorText : 'text-[#8E8E93]'
              }`}
            >
              {tuningHint}
            </span>
          </div>
        </div>

        {/* Горизонтальная прецизионная шкала (-50 .. 0 .. +50 ct) */}
        <div className="pt-1">
          <div className="flex items-center justify-between text-[10px] sm:text-[11px] font-mono tabular-nums text-[#8E8E93] px-1 mb-1.5">
            <span>-50</span>
            <span>-25</span>
            <span
              className={`font-bold ${
                hasSignal && targetStringInfo.isInTune
                  ? 'text-[#10B981]'
                  : 'text-[#FAFAFA]'
              }`}
            >
              0 ct
            </span>
            <span>+25</span>
            <span>+50</span>
          </div>

          <div className="relative h-12 sm:h-14 rounded-2xl bg-[#0A0A0A] border border-[#262626] px-4 flex items-center overflow-hidden">
            <div
              className={`absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-[8%] transition-opacity duration-150 ${
                hasSignal && targetStringInfo.isInTune
                  ? 'bg-[#10B981]/25 opacity-100'
                  : 'bg-[#10B981]/10 opacity-60'
              }`}
            />

            <div className="relative w-full flex items-center justify-between">
              {SCALE_TICKS.map((tick) => {
                const isCenter = tick === 0;
                const isMajor = tick % 20 === 0;
                return (
                  <div
                    key={tick}
                    className="flex flex-col items-center justify-center"
                  >
                    <div
                      className={`rounded-full transition-colors ${
                        isCenter
                          ? hasSignal && targetStringInfo.isInTune
                            ? 'w-1 h-8 bg-[#10B981]'
                            : 'w-0.5 h-7 bg-[#FAFAFA]'
                          : isMajor
                          ? 'w-0.5 h-3.5 bg-[#3F3F46]'
                          : 'w-px h-2 bg-[#262626]'
                      }`}
                    />
                  </div>
                );
              })}
            </div>

            <div
              className="absolute top-1.5 bottom-1.5 left-4 right-4 pointer-events-none"
              aria-hidden="true"
            >
              <div
                className="h-full w-full transition-transform duration-75 ease-out"
                style={{
                  transform: `translate3d(${indicatorPercent - 50}%, 0, 0)`,
                }}
              >
                <div
                  className={`mx-auto h-full w-1.5 rounded-full transition-colors duration-150 ${
                    hasSignal
                      ? `${statusColorBg} shadow-[0_0_12px_rgba(16,185,129,0.45)]`
                      : 'bg-[#3F3F46]'
                  }`}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Секция 6 струн + эталонный тон (без лишней вложенной рамки) */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2 px-0.5">
          <div className="text-xs text-[#8E8E93] truncate">
            {lockedStringIdx === null
              ? 'Нажмите на струну для ручной фиксации'
              : `Фиксация: ${activePreset.strings[lockedStringIdx]?.stringNumber}-я струна`}
          </div>

          <button
            type="button"
            onClick={handleToggleReferenceTone}
            className={`min-h-[38px] px-3 rounded-xl border text-xs font-medium transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
              playingRefStringIdx !== null
                ? 'bg-[#10B981] text-[#0A0A0A] border-[#10B981] font-semibold'
                : 'bg-[#141414] border-[#262626] text-[#FAFAFA] hover:border-[#3F3F46]'
            }`}
          >
            {playingRefStringIdx !== null ? (
              <>
                <VolumeX className="w-3.5 h-3.5" />
                <span>Стоп</span>
              </>
            ) : (
              <>
                <Volume2 className="w-3.5 h-3.5 text-[#10B981]" />
                <span className="font-mono">
                  Тон {targetStringInfo.stringObj.note}
                  {targetStringInfo.stringObj.octave}
                </span>
              </>
            )}
          </button>
        </div>

        <div className="grid grid-cols-6 gap-1.5">
          {activePreset.strings.map((str, idx) => {
            const isLocked = lockedStringIdx === idx;
            const isAutoDetected =
              lockedStringIdx === null &&
              hasSignal &&
              targetStringInfo.index === idx;
            const isActiveTarget = isLocked || isAutoDetected;
            const isThisInTune =
              isActiveTarget && hasSignal && targetStringInfo.isInTune;

            return (
              <button
                key={str.stringNumber}
                type="button"
                onClick={() => handleSelectString(idx)}
                className={`min-h-[64px] py-2 px-0.5 rounded-xl border flex flex-col items-center justify-between transition-all active:scale-95 cursor-pointer ${
                  isThisInTune
                    ? 'bg-[#10B981]/15 border-[#10B981] text-[#10B981]'
                    : isLocked
                    ? 'bg-[#1C1C1C] border-[#FAFAFA] text-[#FAFAFA]'
                    : isAutoDetected
                    ? 'bg-[#1C1C1C] border-[#F59E0B] text-[#FAFAFA]'
                    : 'bg-[#141414] border-[#262626] text-[#8E8E93] hover:border-[#3F3F46] hover:text-[#FAFAFA]'
                }`}
              >
                <span className="text-[10px] font-mono tabular-nums opacity-70">
                  {str.stringNumber}
                </span>
                <span className="text-sm sm:text-base font-mono tabular-nums font-bold text-[#FAFAFA]">
                  {str.note}
                  <span className="text-[11px] font-normal opacity-80">
                    {str.octave}
                  </span>
                </span>
                <span className="text-[9px] font-mono tabular-nums opacity-70">
                  {Math.round(str.frequency)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {micError && (
        <div className="px-3 py-2 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/40 flex items-center gap-2 text-xs text-[#EF4444] shrink-0">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="truncate">{micError}</span>
        </div>
      )}

      {/* 4. Главная кнопка микрофона */}
      <button
        type="button"
        onClick={handleToggleMic}
        className={`w-full min-h-[50px] rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.99] cursor-pointer shrink-0 ${
          isListening
            ? 'bg-[#141414] border border-[#262626] text-[#FAFAFA] hover:border-[#EF4444]/60'
            : 'bg-[#10B981] text-[#0A0A0A] hover:bg-[#059669] shadow-lg shadow-[#10B981]/15'
        }`}
      >
        {isListening ? (
          <>
            <MicOff className="w-4 h-4 text-[#EF4444]" />
            <span>Выключить микрофон</span>
          </>
        ) : (
          <>
            <Mic className="w-4 h-4" />
            <span>Включить микрофон</span>
          </>
        )}
      </button>

      {/* Всплывающая шторка настройки Noise Gate (не сдвигает экран тюнера) */}
      {showGateModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm"
          onClick={() => setShowGateModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-t-3xl sm:rounded-3xl bg-[#141414] border-t sm:border border-[#262626] p-5 pb-safe space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#FAFAFA]">
                Шумоподавитель тюнера (RMS Gate)
              </h3>
              <button
                type="button"
                onClick={() => setShowGateModal(false)}
                className="min-h-[38px] min-w-[38px] -mr-2 flex items-center justify-center text-[#8E8E93] hover:text-[#FAFAFA] cursor-pointer"
                aria-label="Закрыть"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-[#8E8E93]">
              Увеличьте порог, если тюнер реагирует на фоновый шум в комнате.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0.002}
                max={0.03}
                step={0.001}
                value={noiseGateSensitivity}
                onChange={(e) => handleGateChange(parseFloat(e.target.value))}
                className="w-full te-slider"
                aria-label="Порог шумоподавления"
              />
              <span className="font-mono tabular-nums text-xs text-[#FAFAFA] w-14 text-right">
                {Math.round(noiseGateSensitivity * 1000)} мВ
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowGateModal(false)}
              className="w-full min-h-[44px] rounded-xl bg-[#10B981] text-[#0A0A0A] text-sm font-semibold cursor-pointer"
            >
              Готово
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
