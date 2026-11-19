import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bell,
  Eye,
  Hand,
  Minus,
  Play,
  Plus,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { MetronomeEngine } from '../audio/metronomeEngine';
import { TimeSignature } from '../types/tuning';

interface MetronomeViewProps {
  isPlaying: boolean;
  onPlayingChange: (playing: boolean) => void;
  onVisualBeatPulse: (isAccent: boolean) => void;
  visualPulseEnabled: boolean;
  onToggleVisualPulse: () => void;
}

const TIME_SIGNATURES: TimeSignature[] = ['2/4', '3/4', '4/4', '6/8'];

function getTempoLabel(bpm: number): string {
  if (bpm < 45) return 'Grave';
  if (bpm < 60) return 'Largo';
  if (bpm < 76) return 'Adagio';
  if (bpm < 108) return 'Andante';
  if (bpm < 120) return 'Moderato';
  if (bpm < 156) return 'Allegro';
  if (bpm < 176) return 'Vivace';
  if (bpm < 200) return 'Presto';
  return 'Prestissimo';
}

export const MetronomeView: React.FC<MetronomeViewProps> = ({
  isPlaying,
  onPlayingChange,
  onVisualBeatPulse,
  visualPulseEnabled,
  onToggleVisualPulse,
}) => {
  const engineRef = useRef<MetronomeEngine | null>(null);
  const tapTimesRef = useRef<number[]>([]);

  const [bpm, setBpm] = useState<number>(120);
  const [timeSignature, setTimeSignature] = useState<TimeSignature>('4/4');
  const [accentFirstBeat, setAccentFirstBeat] = useState<boolean>(true);
  const [volume, setVolume] = useState<number>(0.8);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [activeBeatIndex, setActiveBeatIndex] = useState<number | null>(null);

  const beatsCount = parseInt(timeSignature.split('/')[0], 10) || 4;

  useEffect(() => {
    const engine = new MetronomeEngine();
    engine.setBpm(120);
    engine.setTimeSignature('4/4');
    engine.setAccentFirstBeat(true);
    engine.setVolume(0.8);

    engineRef.current = engine;

    return () => {
      engine.stop();
      onPlayingChange(false);
    };
  }, [onPlayingChange]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setVisualCallback((beatIndex, isAccent) => {
      setActiveBeatIndex(beatIndex);
      onVisualBeatPulse(isAccent);
    });
  }, [onVisualBeatPulse]);

  const updateBpm = useCallback((nextBpm: number) => {
    const clamped = Math.max(30, Math.min(240, Math.round(nextBpm)));
    setBpm(clamped);
    engineRef.current?.setBpm(clamped);
  }, []);

  const handleTogglePlay = async () => {
    const engine = engineRef.current;
    if (!engine) return;

    if (isPlaying) {
      engine.stop();
      onPlayingChange(false);
      setActiveBeatIndex(null);
    } else {
      await engine.start();
      onPlayingChange(true);
    }
  };

  const handleSelectTimeSignature = (sig: TimeSignature) => {
    setTimeSignature(sig);
    engineRef.current?.setTimeSignature(sig);
    setActiveBeatIndex(null);
  };

  const handleToggleAccent = () => {
    setAccentFirstBeat((prev) => {
      const next = !prev;
      engineRef.current?.setAccentFirstBeat(next);
      return next;
    });
  };

  const handleVolumeChange = (nextVol: number) => {
    setVolume(nextVol);
    if (nextVol > 0 && isMuted) {
      setIsMuted(false);
    }
    engineRef.current?.setVolume(isMuted ? 0 : nextVol);
  };

  const handleToggleMute = () => {
    setIsMuted((prev) => {
      const nextMuted = !prev;
      engineRef.current?.setVolume(nextMuted ? 0 : volume);
      return nextMuted;
    });
  };

  const handleTapTempo = () => {
    const now = performance.now();
    const taps = tapTimesRef.current;

    if (taps.length > 0 && now - taps[taps.length - 1] > 2200) {
      tapTimesRef.current = [now];
      return;
    }

    taps.push(now);
    if (taps.length > 5) {
      taps.shift();
    }

    if (taps.length >= 2) {
      let totalInterval = 0;
      for (let i = 1; i < taps.length; i++) {
        totalInterval += taps[i] - taps[i - 1];
      }
      const avgIntervalMs = totalInterval / (taps.length - 1);
      const calculatedBpm = Math.round(60000 / avgIntervalMs);
      updateBpm(calculatedBpm);
    }
  };

  return (
    <div className="flex flex-col gap-4 w-full max-w-4xl mx-auto">
      {/* 1. Единая консоль метронома: доли такта + BPM + ползунок + Tap Tempo */}
      <div className="rounded-3xl bg-[#141414] border border-[#262626] p-5 sm:p-7 space-y-6">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs text-[#8E8E93] font-mono tabular-nums">
              {timeSignature} · {getTempoLabel(bpm)}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-[#52525B] mt-0.5">
              {isPlaying && activeBeatIndex !== null
                ? `Доля ${activeBeatIndex + 1} из ${beatsCount}`
                : 'Готов к запуску'}
            </div>
          </div>

          <button
            type="button"
            onClick={handleTapTempo}
            className="min-h-[44px] px-3.5 rounded-xl bg-[#0A0A0A] border border-[#262626] hover:border-[#10B981] active:scale-95 transition-all flex items-center gap-1.5 text-xs font-semibold text-[#FAFAFA] cursor-pointer"
          >
            <Hand className="w-3.5 h-3.5 text-[#10B981]" />
            <span>TAP TEMPO</span>
          </button>
        </div>

        {/* Индикатор долей такта */}
        <div className="flex items-center justify-center gap-2 sm:gap-3">
          {Array.from({ length: beatsCount }).map((_, idx) => {
            const isCurrent = isPlaying && activeBeatIndex === idx;
            const isAccentedBeat = accentFirstBeat && idx === 0;

            return (
              <div
                key={idx}
                className={`flex-1 max-w-[68px] h-11 rounded-xl border flex items-center justify-center transition-all duration-75 ${
                  isCurrent
                    ? isAccentedBeat
                      ? 'bg-[#10B981] border-[#10B981] text-[#0A0A0A] scale-105 shadow-[0_0_16px_rgba(16,185,129,0.45)]'
                      : 'bg-[#FAFAFA] border-[#FAFAFA] text-[#0A0A0A] scale-105'
                    : isAccentedBeat
                    ? 'bg-[#0A0A0A] border-[#10B981]/40 text-[#10B981]'
                    : 'bg-[#0A0A0A] border-[#262626] text-[#52525B]'
                }`}
              >
                <span className="font-mono tabular-nums text-sm font-bold">
                  {idx + 1}
                </span>
              </div>
            );
          })}
        </div>

        {/* Центральный регулятор BPM */}
        <div className="flex items-center justify-between gap-3 py-1">
          <button
            type="button"
            onClick={() => updateBpm(bpm - 1)}
            disabled={bpm <= 30}
            className="min-h-[54px] min-w-[54px] sm:min-w-[64px] rounded-2xl bg-[#0A0A0A] border border-[#262626] hover:border-[#3F3F46] active:scale-95 disabled:opacity-40 transition-all flex items-center justify-center text-[#FAFAFA] font-mono tabular-nums text-sm font-semibold cursor-pointer"
            aria-label="Уменьшить темп на 1 BPM"
          >
            <Minus className="w-4 h-4 mr-0.5" />1
          </button>

          <div className="text-center">
            <div className="font-mono tabular-nums text-6xl sm:text-7xl font-bold tracking-tight leading-none text-[#FAFAFA]">
              {bpm}
            </div>
            <div className="text-xs font-mono text-[#8E8E93] mt-1.5">
              BPM
            </div>
          </div>

          <button
            type="button"
            onClick={() => updateBpm(bpm + 1)}
            disabled={bpm >= 240}
            className="min-h-[54px] min-w-[54px] sm:min-w-[64px] rounded-2xl bg-[#0A0A0A] border border-[#262626] hover:border-[#3F3F46] active:scale-95 disabled:opacity-40 transition-all flex items-center justify-center text-[#FAFAFA] font-mono tabular-nums text-sm font-semibold cursor-pointer"
            aria-label="Увеличить темп на 1 BPM"
          >
            <Plus className="w-4 h-4 mr-0.5" />1
          </button>
        </div>

        <div className="space-y-1.5">
          <input
            type="range"
            min={30}
            max={240}
            step={1}
            value={bpm}
            onChange={(e) => updateBpm(Number(e.target.value))}
            className="w-full te-slider"
            aria-label="Ползунок темпа BPM"
          />
          <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-[#8E8E93]">
            <span>30</span>
            <span>90</span>
            <span>120</span>
            <span>180</span>
            <span>240</span>
          </div>
        </div>
      </div>

      {/* 2. Чистые настройки размера, акцента, пульсации и громкости */}
      <div className="space-y-3">
        <div className="grid grid-cols-4 gap-2">
          {TIME_SIGNATURES.map((sig) => {
            const active = timeSignature === sig;
            return (
              <button
                key={sig}
                type="button"
                onClick={() => handleSelectTimeSignature(sig)}
                className={`min-h-[44px] rounded-xl font-mono tabular-nums text-sm font-semibold border transition-all cursor-pointer ${
                  active
                    ? 'bg-[#10B981]/15 border-[#10B981] text-[#10B981]'
                    : 'bg-[#141414] border-[#262626] text-[#8E8E93] hover:text-[#FAFAFA]'
                }`}
              >
                {sig}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleToggleAccent}
            className={`min-h-[44px] px-3 rounded-xl border text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              accentFirstBeat
                ? 'bg-[#141414] border-[#10B981]/50 text-[#FAFAFA]'
                : 'bg-[#141414] border-[#262626] text-[#8E8E93]'
            }`}
          >
            <Bell
              className={`w-3.5 h-3.5 shrink-0 ${
                accentFirstBeat ? 'text-[#10B981]' : 'text-[#52525B]'
              }`}
            />
            <span className="truncate">Акцент 1-й доли</span>
          </button>

          <button
            type="button"
            onClick={onToggleVisualPulse}
            className={`min-h-[44px] px-3 rounded-xl border text-xs font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              visualPulseEnabled
                ? 'bg-[#141414] border-[#10B981]/50 text-[#FAFAFA]'
                : 'bg-[#141414] border-[#262626] text-[#8E8E93]'
            }`}
          >
            <Eye
              className={`w-3.5 h-3.5 shrink-0 ${
                visualPulseEnabled ? 'text-[#10B981]' : 'text-[#52525B]'
              }`}
            />
            <span className="truncate">Визуальная пульсация</span>
          </button>
        </div>

        <div className="rounded-2xl bg-[#141414] border border-[#262626] px-3.5 py-2.5 flex items-center gap-3">
          <button
            type="button"
            onClick={handleToggleMute}
            className={`min-h-[40px] min-w-[40px] rounded-xl border flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
              isMuted
                ? 'bg-[#EF4444]/15 border-[#EF4444]/50 text-[#EF4444]'
                : 'bg-[#0A0A0A] border-[#262626] text-[#FAFAFA]'
            }`}
            aria-label={isMuted ? 'Включить звук' : 'Выключить звук'}
          >
            {isMuted ? (
              <VolumeX className="w-4 h-4" />
            ) : (
              <Volume2 className="w-4 h-4 text-[#10B981]" />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={isMuted ? 0 : volume}
            onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
            className="w-full te-slider"
            aria-label="Громкость метронома"
          />
          <span className="font-mono tabular-nums text-xs text-[#8E8E93] w-10 text-right shrink-0">
            {isMuted ? '0%' : `${Math.round(volume * 100)}%`}
          </span>
        </div>
      </div>

      {/* 3. Главная кнопка Старт / Стоп */}
      <button
        type="button"
        onClick={handleTogglePlay}
        className={`w-full min-h-[54px] rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.99] cursor-pointer ${
          isPlaying
            ? 'bg-[#141414] border border-[#262626] text-[#FAFAFA] hover:border-[#EF4444]/60'
            : 'bg-[#10B981] text-[#0A0A0A] hover:bg-[#059669] shadow-lg shadow-[#10B981]/15'
        }`}
      >
        {isPlaying ? (
          <>
            <Square className="w-4 h-4 text-[#EF4444] fill-[#EF4444]" />
            <span>Остановить метроном</span>
          </>
        ) : (
          <>
            <Play className="w-4 h-4 fill-[#0A0A0A]" />
            <span>Запустить метроном</span>
          </>
        )}
      </button>
    </div>
  );
};
