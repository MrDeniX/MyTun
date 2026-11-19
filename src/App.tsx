/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Activity, BookOpen, Gauge, Sun } from 'lucide-react';
import { MetronomeView } from './components/MetronomeView';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { TabsView } from './components/TabsView';
import { TunerView } from './components/TunerView';
import { TuningDrawer } from './components/TuningDrawer';
import { useWakeLock } from './hooks/useWakeLock';
import {
  BUILTIN_TUNING_PRESETS,
  loadActiveTuningId,
  loadCustomTunings,
  saveActiveTuningId,
  saveCustomTunings,
} from './services/tuningStorage';
import { SongScore, convertSongTuningToPreset } from './types/tabs';
import { TuningPreset } from './types/tuning';

type ActiveTab = 'tuner' | 'tabs' | 'metronome';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('tuner');
  const [customPresets, setCustomPresets] = useState<TuningPreset[]>(() =>
    loadCustomTunings()
  );
  const [activePresetId, setActivePresetId] = useState<string>(() =>
    loadActiveTuningId()
  );
  const [isPresetDrawerOpen, setIsPresetDrawerOpen] = useState(false);

  const [isTunerListening, setIsTunerListening] = useState(false);
  const [isTabsPracticing, setIsTabsPracticing] = useState(false);
  const [isMetronomePlaying, setIsMetronomePlaying] = useState(false);

  const [visualPulseEnabled, setVisualPulseEnabled] = useState(true);
  const [pulseState, setPulseState] = useState<'none' | 'accent' | 'beat'>('none');
  const pulseTimeoutRef = useRef<number | null>(null);

  const shouldKeepScreenAwake =
    isTunerListening || isTabsPracticing || isMetronomePlaying;
  const { isLocked: isWakeLockActive } = useWakeLock(shouldKeepScreenAwake);

  const allPresets = useMemo(
    () => [...BUILTIN_TUNING_PRESETS, ...customPresets],
    [customPresets]
  );

  const activePreset = useMemo(
    () =>
      allPresets.find((p) => p.id === activePresetId) || BUILTIN_TUNING_PRESETS[0],
    [allPresets, activePresetId]
  );

  const handleSelectPreset = useCallback((id: string) => {
    setActivePresetId(id);
    saveActiveTuningId(id);
  }, []);

  const handleSaveCustomPreset = useCallback((newPreset: TuningPreset) => {
    setCustomPresets((prev) => {
      const updated = [newPreset, ...prev];
      saveCustomTunings(updated);
      return updated;
    });
    setActivePresetId(newPreset.id);
    saveActiveTuningId(newPreset.id);
  }, []);

  const handleDeleteCustomPreset = useCallback(
    (id: string) => {
      setCustomPresets((prev) => {
        const updated = prev.filter((p) => p.id !== id);
        saveCustomTunings(updated);
        return updated;
      });
      if (activePresetId === id) {
        const fallbackId = BUILTIN_TUNING_PRESETS[0].id;
        setActivePresetId(fallbackId);
        saveActiveTuningId(fallbackId);
      }
    },
    [activePresetId]
  );

  const handleTuneForSong = useCallback(
    (song: SongScore) => {
      const tabPreset = convertSongTuningToPreset(song);
      const existingMatch = allPresets.find(
        (p) => p.subtitle.toLowerCase() === tabPreset.subtitle.toLowerCase()
      );

      if (existingMatch) {
        handleSelectPreset(existingMatch.id);
      } else {
        handleSaveCustomPreset(tabPreset);
      }

      setActiveTab('tuner');
    },
    [allPresets, handleSelectPreset, handleSaveCustomPreset]
  );

  const handleVisualBeatPulse = useCallback(
    (isAccent: boolean) => {
      if (!visualPulseEnabled) return;
      if (pulseTimeoutRef.current !== null) {
        clearTimeout(pulseTimeoutRef.current);
      }
      setPulseState(isAccent ? 'accent' : 'beat');
      pulseTimeoutRef.current = window.setTimeout(() => {
        setPulseState('none');
      }, 110);
    },
    [visualPulseEnabled]
  );

  const headerModeLabel =
    activeTab === 'tuner'
      ? 'DSP YIN'
      : activeTab === 'tabs'
      ? 'ТАБЫ · DSP'
      : 'LOOKAHEAD';

  return (
    <div className="min-h-dvh bg-[#0A0A0A] text-[#FAFAFA] flex flex-col relative select-none">
      {/* Визуальная пульсация контура экрана в такт метроному */}
      {visualPulseEnabled && pulseState !== 'none' && (
        <div
          className={`pointer-events-none fixed inset-0 z-50 transition-opacity duration-75 ${
            pulseState === 'accent'
              ? 'ring-4 ring-inset ring-[#10B981]/80 bg-[#10B981]/[0.03]'
              : 'ring-2 ring-inset ring-[#FAFAFA]/40'
          }`}
          aria-hidden="true"
        />
      )}

      <OfflineIndicator />

      {/* Компактная верхняя панель (44px + safe-area) */}
      <header className="sticky top-0 z-30 bg-[#0A0A0A]/92 backdrop-blur-md border-b border-[#262626] pt-safe">
        <div className="max-w-4xl mx-auto px-3.5 sm:px-5 h-11 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 whitespace-nowrap shrink-0">
            <span className="font-mono font-bold tracking-tight text-sm sm:text-base text-[#FAFAFA]">
              TONE.01
            </span>
            <span className="text-xs text-[#52525B]" aria-hidden="true">·</span>
            <span className="text-[11px] text-[#8E8E93] font-mono">
              {headerModeLabel}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isWakeLockActive && (
              <div
                className="flex items-center gap-1 text-[11px] text-[#8E8E93]"
                title="Экран удерживается включенным (Wake Lock)"
              >
                <Sun className="w-3.5 h-3.5 text-[#10B981]" />
                <span className="hidden sm:inline">Экран активен</span>
              </div>
            )}
            <PWAInstallButton />
          </div>
        </div>
      </header>

      {/* Свободно прокручиваемая рабочая область (без обрезки контента на любых экранах) */}
      <main className="flex-1 w-full px-3.5 sm:px-5 pt-3 pb-24">
        <div className={activeTab === 'tuner' ? 'block' : 'hidden'}>
          <TunerView
            activePreset={activePreset}
            isVisible={activeTab === 'tuner'}
            onOpenPresetDrawer={() => setIsPresetDrawerOpen(true)}
            isListening={isTunerListening}
            onListeningChange={setIsTunerListening}
          />
        </div>

        <div className={activeTab === 'tabs' ? 'block' : 'hidden'}>
          <TabsView
            isActiveTab={activeTab === 'tabs'}
            onTuneForSong={handleTuneForSong}
            onPracticeActiveChange={setIsTabsPracticing}
          />
        </div>

        <div className={activeTab === 'metronome' ? 'block' : 'hidden'}>
          <MetronomeView
            isPlaying={isMetronomePlaying}
            onPlayingChange={setIsMetronomePlaying}
            onVisualBeatPulse={handleVisualBeatPulse}
            visualPulseEnabled={visualPulseEnabled}
            onToggleVisualPulse={() => setVisualPulseEnabled((prev) => !prev)}
          />
        </div>
      </main>

      {/* Фиксированная нижняя панель навигации (зона большого пальца) */}
      <nav
        aria-label="Основная навигация"
        className="fixed bottom-0 left-0 right-0 z-40 bg-[#0A0A0A]/92 backdrop-blur-md border-t border-[#262626] pb-safe"
      >
        <div className="max-w-lg mx-auto px-3 h-14 grid grid-cols-3 gap-2 items-center">
          <button
            type="button"
            onClick={() => setActiveTab('tuner')}
            className={`min-h-[44px] px-2 rounded-xl border flex items-center justify-center gap-1.5 text-xs sm:text-sm font-semibold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'tuner'
                ? 'bg-[#141414] border-[#10B981] text-[#10B981]'
                : 'bg-transparent border-transparent text-[#8E8E93] hover:text-[#FAFAFA]'
            }`}
          >
            <Gauge className="w-4 h-4 shrink-0" />
            <span>Тюнер</span>
            {isTunerListening && (
              <span className="text-[10px] font-mono text-[#10B981]">ON</span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('tabs')}
            className={`min-h-[44px] px-2 rounded-xl border flex items-center justify-center gap-1.5 text-xs sm:text-sm font-semibold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'tabs'
                ? 'bg-[#141414] border-[#10B981] text-[#10B981]'
                : 'bg-transparent border-transparent text-[#8E8E93] hover:text-[#FAFAFA]'
            }`}
          >
            <BookOpen className="w-4 h-4 shrink-0" />
            <span>Табы</span>
            {isTabsPracticing && (
              <span className="text-[10px] font-mono text-[#10B981]">ON</span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('metronome')}
            className={`min-h-[44px] px-2 rounded-xl border flex items-center justify-center gap-1.5 text-xs sm:text-sm font-semibold transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'metronome'
                ? 'bg-[#141414] border-[#10B981] text-[#10B981]'
                : 'bg-transparent border-transparent text-[#8E8E93] hover:text-[#FAFAFA]'
            }`}
          >
            <Activity className="w-4 h-4 shrink-0" />
            <span>Метроном</span>
            {isMetronomePlaying && (
              <span className="text-[10px] font-mono text-[#10B981]">ON</span>
            )}
          </button>
        </div>
      </nav>

      {/* Шторка выбора и создания гитарных строев */}
      <TuningDrawer
        isOpen={isPresetDrawerOpen}
        onClose={() => setIsPresetDrawerOpen(false)}
        presets={allPresets}
        activePresetId={activePreset.id}
        onSelectPreset={handleSelectPreset}
        onSaveCustomPreset={handleSaveCustomPreset}
        onDeleteCustomPreset={handleDeleteCustomPreset}
      />
    </div>
  );
}
