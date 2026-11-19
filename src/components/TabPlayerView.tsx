import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Bell,
  BellOff,
  CheckCircle2,
  Gauge,
  Maximize2,
  Mic,
  Minimize2,
  Minus,
  Pause,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  SkipForward,
  SlidersHorizontal,
  Trophy,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import { ensureAudioContextResumed, getSharedAudioContext } from '../audio/audioContextManager';
import { GuitarPluckSynth } from '../audio/guitarPluckSynth';
import {
  PracticeDifficulty,
  PracticeDspEngine,
  PracticeEvaluationResult,
  TargetBeatExpectation,
} from '../audio/practiceDspEngine';
import {
  BeatEvaluationStatus,
  FlatBeatPointer,
  SongScore,
  computeNoteTargetMidi,
  flattenSongBeats,
  midiToLabel,
} from '../types/tabs';
import { TabCanvasRenderer } from './TabCanvasRenderer';

type PracticeMode = 'wait' | 'playAlong';

interface SessionStats {
  accuracy: number;
  hits: number;
  wrongs: number;
  missed: number;
  total: number;
  isNewBest: boolean;
}

interface TabPlayerViewProps {
  song: SongScore;
  isVisible: boolean;
  onBackToLibrary: () => void;
  onTuneForSong: (song: SongScore) => void;
  onSaveBestAccuracy: (songId: string, accuracy: number) => void;
  onActiveChange: (isActive: boolean) => void;
}

interface ScheduledPlayAlongEvent {
  flatIndex: number;
  time: number;
  isCycleEnd?: boolean;
}

const SPEED_PRESETS = [50, 75, 100];
const GATE_STORAGE_KEY = 'tone01_practice_gate_v2';
const SLAP_STORAGE_KEY = 'tone01_slap_sensitivity_v1';
const AUTO_SLAP_STORAGE_KEY = 'tone01_auto_slap_v1';
const DIFFICULTY_STORAGE_KEY = 'tone01_practice_difficulty_v1';

const DIFFICULTY_OPTIONS: Array<{
  id: PracticeDifficulty;
  label: string;
  hint: string;
}> = [
  {
    id: 'arcade',
    label: 'Аркадный',
    hint: 'Мягкий допуск высоты и засчёт аккорда по главной ноте — легко играть в удовольствие.',
  },
  {
    id: 'medium',
    label: 'Средний',
    hint: 'Сбалансированный режим: гибрид YIN + Goertzel и честное распознавание половины нот аккорда.',
  },
  {
    id: 'pro',
    label: 'Профи',
    hint: 'Строгий контроль строя (±35 ct) и чистого звучания большинства струн в аккорде.',
  },
];

function loadSavedNumber(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const num = parseFloat(raw);
    if (Number.isFinite(num)) return Math.max(min, Math.min(max, num));
  } catch {
    // ignore
  }
  return fallback;
}

function isLegatoBeat(ptr: FlatBeatPointer | undefined): boolean {
  if (!ptr || ptr.beat.notes.length === 0) return false;
  return ptr.beat.notes.some(
    (n) => n.technique === 'hammer' || n.technique === 'slide'
  );
}

function getBeatMidis(
  ptr: FlatBeatPointer | undefined,
  openStringMidi: number[]
): number[] {
  if (!ptr || ptr.beat.isRest) return [];
  return ptr.beat.notes
    .map((n) => computeNoteTargetMidi(n, openStringMidi, ptr.effectiveCapo))
    .filter((m): m is number => m !== null);
}

export const TabPlayerView: React.FC<TabPlayerViewProps> = ({
  song,
  isVisible,
  onBackToLibrary,
  onTuneForSong,
  onSaveBestAccuracy,
  onActiveChange,
}) => {
  const dspRef = useRef<PracticeDspEngine | null>(null);
  const synthRef = useRef<GuitarPluckSynth | null>(null);

  const [mode, setMode] = useState<PracticeMode>('wait');
  const [isRunning, setIsRunning] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  // Минималистичный режим «Фокус» — скрывает вспомогательные панели во время игры
  const [isFocusMode, setIsFocusMode] = useState(false);

  // Инструменты разбора и калибровки
  const [speedPercent, setSpeedPercent] = useState<number>(100);
  const [manualCapoOffset, setManualCapoOffset] = useState<number>(0);
  const [synthGuideEnabled, setSynthGuideEnabled] = useState<boolean>(true);
  const [metronomeEnabled, setMetronomeEnabled] = useState<boolean>(true);
  const [loopEnabled, setLoopEnabled] = useState<boolean>(false);
  const [loopStartMeasure, setLoopStartMeasure] = useState<number>(1);
  const [loopEndMeasure, setLoopEndMeasure] = useState<number>(
    Math.max(1, song.measures.length)
  );

  // Сохраняемые параметры: строгость распознавания (по умолчанию Средний), порог шума и авто-щелчок
  const [difficulty, setDifficulty] = useState<PracticeDifficulty>(() => {
    try {
      const raw = localStorage.getItem(DIFFICULTY_STORAGE_KEY);
      if (raw === 'arcade' || raw === 'medium' || raw === 'pro') return raw;
    } catch {
      // ignore
    }
    return 'medium';
  });
  const [noiseGateValue, setNoiseGateValue] = useState<number>(() =>
    loadSavedNumber(GATE_STORAGE_KEY, 0.0075, 0.003, 0.05)
  );
  const [autoSlapEnabled, setAutoSlapEnabled] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(AUTO_SLAP_STORAGE_KEY);
      return raw === null ? true : raw === 'true';
    } catch {
      return true;
    }
  });
  const [slapSensitivity, setSlapSensitivity] = useState<number>(() =>
    loadSavedNumber(SLAP_STORAGE_KEY, 0.72, 0.05, 1.0)
  );

  const [isSettingsSheetOpen, setIsSettingsSheetOpen] = useState(false);

  // Прогресс курсора и результаты по битам
  const [activeFlatIndex, setActiveFlatIndex] = useState<number>(0);
  const [beatStatuses, setBeatStatuses] = useState<Record<number, BeatEvaluationStatus>>({});
  const [liveEval, setLiveEval] = useState<PracticeEvaluationResult>({
    rms: 0,
    slapImpulse: 0,
    slapTriggered: false,
    isOnset: false,
    waitingForAttack: false,
    autoSlapCalibrated: false,
    matched: false,
    isWrongPitch: false,
    detectedLabel: null,
    cents: null,
    checkKind: 'single',
  });
  const [slapFlashUntil, setSlapFlashUntil] = useState<number>(0);
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null);

  const flatBeats = useMemo(
    () => flattenSongBeats(song, manualCapoOffset),
    [song, manualCapoOffset]
  );

  const totalMeasures = Math.max(1, song.measures.length);

  const playRange = useMemo(() => {
    if (!loopEnabled || flatBeats.length === 0) {
      return { startIdx: 0, endIdx: Math.max(0, flatBeats.length - 1) };
    }
    const minM = Math.min(loopStartMeasure, loopEndMeasure);
    const maxM = Math.max(loopStartMeasure, loopEndMeasure);
    let startIdx = flatBeats.findIndex((b) => b.measureNumber >= minM);
    if (startIdx < 0) startIdx = 0;

    let endIdx = flatBeats.length - 1;
    for (let i = flatBeats.length - 1; i >= 0; i--) {
      if (flatBeats[i].measureNumber <= maxM) {
        endIdx = i;
        break;
      }
    }
    return { startIdx, endIdx: Math.max(startIdx, endIdx) };
  }, [flatBeats, loopEnabled, loopStartMeasure, loopEndMeasure]);

  // Ref-зеркала состояния для DSP и Lookahead
  const modeRef = useRef(mode);
  const isRunningRef = useRef(isRunning);
  const activeIdxRef = useRef(activeFlatIndex);
  const flatBeatsRef = useRef(flatBeats);
  const playRangeRef = useRef(playRange);
  const speedRef = useRef(speedPercent);
  const synthGuideRef = useRef(synthGuideEnabled);
  const metronomeRef = useRef(metronomeEnabled);
  const loopEnabledRef = useRef(loopEnabled);
  const beatStatusesRef = useRef(beatStatuses);
  const currentBeatWrongHeardRef = useRef(false);
  const lastUiEvalPushRef = useRef(0);

  modeRef.current = mode;
  isRunningRef.current = isRunning;
  activeIdxRef.current = activeFlatIndex;
  flatBeatsRef.current = flatBeats;
  playRangeRef.current = playRange;
  speedRef.current = speedPercent;
  synthGuideRef.current = synthGuideEnabled;
  metronomeRef.current = metronomeEnabled;
  loopEnabledRef.current = loopEnabled;
  beatStatusesRef.current = beatStatuses;

  const schedulerTimerRef = useRef<number | null>(null);
  const visualRafRef = useRef<number | null>(null);
  const nextBeatAudioTimeRef = useRef<number>(0);
  const schedulerCursorIdxRef = useRef<number>(0);
  const scheduledVisualQueueRef = useRef<ScheduledPlayAlongEvent[]>([]);

  useEffect(() => {
    setActiveFlatIndex(0);
    activeIdxRef.current = 0;
    setBeatStatuses({});
    setSessionStats(null);
    setManualCapoOffset(0);
    setLoopEnabled(false);
    setLoopStartMeasure(1);
    setLoopEndMeasure(Math.max(1, song.measures.length));
  }, [song.id, song.measures.length]);

  const stopPlayAlongScheduler = useCallback(() => {
    if (schedulerTimerRef.current !== null) {
      clearTimeout(schedulerTimerRef.current);
      schedulerTimerRef.current = null;
    }
    if (visualRafRef.current !== null) {
      cancelAnimationFrame(visualRafRef.current);
      visualRafRef.current = null;
    }
    scheduledVisualQueueRef.current = [];
  }, []);

  const stopSession = useCallback(() => {
    stopPlayAlongScheduler();
    dspRef.current?.stop();
    isRunningRef.current = false;
    setIsRunning(false);
    onActiveChange(false);
  }, [stopPlayAlongScheduler, onActiveChange]);

  // Автоматически освобождаем микрофон при уходе на другую вкладку
  useEffect(() => {
    if (!isVisible && isRunningRef.current) {
      stopSession();
    }
  }, [isVisible, stopSession]);

  const finalizePlayAlongStats = useCallback(
    (finalStatuses: Record<number, BeatEvaluationStatus>) => {
      const { startIdx, endIdx } = playRangeRef.current;
      const beats = flatBeatsRef.current;
      let hits = 0;
      let wrongs = 0;
      let missed = 0;
      let total = 0;

      for (let i = startIdx; i <= endIdx; i++) {
        const b = beats[i];
        if (!b || b.beat.isRest || b.beat.notes.length === 0) continue;
        total++;
        const st = finalStatuses[i];
        if (st === 'hit') hits++;
        else if (st === 'wrong') wrongs++;
        else missed++;
      }

      const accuracy = total > 0 ? Math.round((hits / total) * 100) : 0;
      const isNewBest =
        typeof song.bestAccuracy !== 'number' || accuracy > song.bestAccuracy;

      if (total > 0) {
        onSaveBestAccuracy(song.id, accuracy);
      }

      setSessionStats({
        accuracy,
        hits,
        wrongs,
        missed,
        total,
        isNewBest,
      });
    },
    [song.id, song.bestAccuracy, onSaveBestAccuracy]
  );

  const findNextPlayableIndex = useCallback((fromIdx: number): number | null => {
    const beats = flatBeatsRef.current;
    const { startIdx, endIdx } = playRangeRef.current;
    for (let i = fromIdx; i <= endIdx; i++) {
      const ptr = beats[i];
      if (ptr && !ptr.beat.isRest && ptr.beat.notes.length > 0) {
        return i;
      }
    }
    if (loopEnabledRef.current) {
      for (let i = startIdx; i <= endIdx; i++) {
        const ptr = beats[i];
        if (ptr && !ptr.beat.isRest && ptr.beat.notes.length > 0) {
          return i;
        }
      }
    }
    return null;
  }, []);

  // Инициализация DSP-движка и Pluck-синтезатора
  useEffect(() => {
    const dsp = new PracticeDspEngine();
    dsp.setDifficulty(difficulty);
    dsp.setNoiseGateThreshold(noiseGateValue);
    dsp.setAutoSlapEnabled(autoSlapEnabled);
    dsp.setSlapSensitivity(slapSensitivity);

    const synth = new GuitarPluckSynth();
    dspRef.current = dsp;
    synthRef.current = synth;

    dsp.configure(
      (): TargetBeatExpectation | null => {
        const ptr = flatBeatsRef.current[activeIdxRef.current];
        if (!ptr || ptr.beat.isRest || ptr.beat.notes.length === 0) {
          return null;
        }
        return {
          notes: ptr.beat.notes,
          openStringMidi: song.tuning.openStringMidi,
          currentCapo: ptr.effectiveCapo,
          requireFreshOnset: modeRef.current === 'wait',
        };
      },
      (result) => {
        const now = performance.now();

        if (result.slapTriggered) {
          setSlapFlashUntil(now + 260);
        }

        // Троттлинг UI (~22 FPS) при мгновенной реакции на попадание/щелчок
        if (
          result.matched ||
          result.slapTriggered ||
          now - lastUiEvalPushRef.current >= 45
        ) {
          lastUiEvalPushRef.current = now;
          setLiveEval(result);
        }

        if (!isRunningRef.current) return;
        const currIdx = activeIdxRef.current;

        if (modeRef.current === 'wait') {
          if (result.matched) {
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
              try {
                navigator.vibrate(12);
              } catch {
                // ignore
              }
            }

            setBeatStatuses((prev) => ({ ...prev, [currIdx]: 'hit' }));

            const currPtr = flatBeatsRef.current[currIdx];
            const prevMidis = getBeatMidis(currPtr, song.tuning.openStringMidi);
            const nextIdx = findNextPlayableIndex(currIdx + 1);

            if (nextIdx !== null) {
              const nextPtr = flatBeatsRef.current[nextIdx];
              const nextMidis = getBeatMidis(nextPtr, song.tuning.openStringMidi);
              const nextHasSlap = Boolean(
                nextPtr?.beat.notes.some((n) => n.technique === 'slap' || n.fret < 0)
              );
              const isSlapOnly = nextHasSlap && nextMidis.length === 0;

              // СИНХРОННО переводим ref на следующую долю и передаем метаданные перехода
              activeIdxRef.current = nextIdx;
              dsp.notifyBeatChanged({
                isImmediate: false,
                isLegato: isLegatoBeat(nextPtr),
                isSlapOnly,
                previousMidis: prevMidis,
                nextMidis,
              });
              setActiveFlatIndex(nextIdx);
              if (nextIdx <= currIdx && loopEnabledRef.current) {
                setBeatStatuses({});
              }
            } else {
              stopSession();
              const updatedStatuses: Record<number, BeatEvaluationStatus> = {
                ...beatStatusesRef.current,
                [currIdx]: 'hit',
              };
              finalizePlayAlongStats(updatedStatuses);
            }
          }
        } else {
          // Режим Play Along ("Под темп")
          const currentStatus = beatStatusesRef.current[currIdx];
          if (currentStatus === 'hit') return;

          if (result.matched) {
            setBeatStatuses((prev) => ({ ...prev, [currIdx]: 'hit' }));
          } else if (result.isWrongPitch) {
            currentBeatWrongHeardRef.current = true;
          }
        }
      }
    );

    return () => {
      stopPlayAlongScheduler();
      dsp.stop();
      onActiveChange(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    song.tuning.openStringMidi,
    findNextPlayableIndex,
    stopSession,
    stopPlayAlongScheduler,
    finalizePlayAlongStats,
    onActiveChange,
  ]);

  const startPlayAlongScheduler = useCallback(
    (startIndex: number) => {
      stopPlayAlongScheduler();
      const ctx = getSharedAudioContext();
      const synth = synthRef.current;

      schedulerCursorIdxRef.current = startIndex;
      nextBeatAudioTimeRef.current = ctx.currentTime + 0.08;
      scheduledVisualQueueRef.current = [];
      currentBeatWrongHeardRef.current = false;

      const lookaheadMs = 25;
      const scheduleAheadSec = 0.1;

      const scheduleLoop = () => {
        if (!isRunningRef.current || modeRef.current !== 'playAlong') return;
        const currentTime = ctx.currentTime;
        const beats = flatBeatsRef.current;
        const { startIdx, endIdx } = playRangeRef.current;

        while (nextBeatAudioTimeRef.current < currentTime + scheduleAheadSec) {
          const idx = schedulerCursorIdxRef.current;

          if (idx > endIdx || !beats[idx]) {
            if (loopEnabledRef.current) {
              scheduledVisualQueueRef.current.push({
                flatIndex: startIdx,
                time: nextBeatAudioTimeRef.current,
                isCycleEnd: true,
              });
              schedulerCursorIdxRef.current = startIdx;
              continue;
            } else {
              scheduledVisualQueueRef.current.push({
                flatIndex: endIdx,
                time: nextBeatAudioTimeRef.current,
                isCycleEnd: true,
              });
              return;
            }
          }

          const ptr = beats[idx];
          const scheduledTime = nextBeatAudioTimeRef.current;
          const scaledBpm = Math.max(
            20,
            ptr.effectiveBpm * (speedRef.current / 100)
          );
          const beatDurationSec = (60 / scaledBpm) * Math.max(0.25, ptr.beat.duration);

          if (metronomeRef.current && synth) {
            const isMeasureStart = ptr.beatIndexInMeasure === 0;
            synth.scheduleMetronomeClick(scheduledTime, isMeasureStart);
          }

          if (
            synthGuideRef.current &&
            synth &&
            !ptr.beat.isRest &&
            ptr.beat.notes.length > 0
          ) {
            synth.scheduleBeatNotes(
              ptr.beat.notes,
              song.tuning.openStringMidi,
              ptr.effectiveCapo,
              scheduledTime,
              beatDurationSec * 0.95
            );
          }

          scheduledVisualQueueRef.current.push({
            flatIndex: idx,
            time: scheduledTime,
          });

          nextBeatAudioTimeRef.current += beatDurationSec;
          schedulerCursorIdxRef.current = idx + 1;
        }

        schedulerTimerRef.current = window.setTimeout(scheduleLoop, lookaheadMs);
      };

      const visualLoop = () => {
        if (!isRunningRef.current || modeRef.current !== 'playAlong') return;
        const now = ctx.currentTime;
        const queue = scheduledVisualQueueRef.current;

        while (queue.length > 0 && queue[0].time <= now) {
          const ev = queue.shift()!;
          const prevIdx = activeIdxRef.current;

          if (prevIdx !== ev.flatIndex || ev.isCycleEnd) {
            const prevPtr = flatBeatsRef.current[prevIdx];
            if (
              prevPtr &&
              !prevPtr.beat.isRest &&
              prevPtr.beat.notes.length > 0 &&
              beatStatusesRef.current[prevIdx] !== 'hit'
            ) {
              const status: BeatEvaluationStatus = currentBeatWrongHeardRef.current
                ? 'wrong'
                : 'missed';
              beatStatusesRef.current = {
                ...beatStatusesRef.current,
                [prevIdx]: status,
              };
              setBeatStatuses((prev) => ({
                ...prev,
                [prevIdx]: status,
              }));
            }
            currentBeatWrongHeardRef.current = false;
          }

          if (ev.isCycleEnd) {
            if (!loopEnabledRef.current) {
              stopSession();
              finalizePlayAlongStats(beatStatusesRef.current);
              return;
            } else {
              finalizePlayAlongStats(beatStatusesRef.current);
              setBeatStatuses({});
              beatStatusesRef.current = {};
              setActiveFlatIndex(ev.flatIndex);
              activeIdxRef.current = ev.flatIndex;
              dspRef.current?.notifyBeatChanged({ isImmediate: true });
            }
          } else {
            const prevPtr = flatBeatsRef.current[prevIdx];
            const nextPtr = flatBeatsRef.current[ev.flatIndex];
            setActiveFlatIndex(ev.flatIndex);
            activeIdxRef.current = ev.flatIndex;
            if (prevIdx !== ev.flatIndex) {
              dspRef.current?.notifyBeatChanged({
                isImmediate: true,
                previousMidis: getBeatMidis(prevPtr, song.tuning.openStringMidi),
                nextMidis: getBeatMidis(nextPtr, song.tuning.openStringMidi),
              });
            }
          }
        }

        visualRafRef.current = requestAnimationFrame(visualLoop);
      };

      scheduleLoop();
      visualRafRef.current = requestAnimationFrame(visualLoop);
    },
    [
      song.tuning.openStringMidi,
      stopPlayAlongScheduler,
      stopSession,
      finalizePlayAlongStats,
    ]
  );

  const handleToggleStart = async () => {
    if (isRunning) {
      stopSession();
      return;
    }

    setMicError(null);
    setSessionStats(null);

    try {
      await ensureAudioContextResumed();
      await dspRef.current?.start();

      let startIdx = activeFlatIndex;
      if (startIdx < playRange.startIdx || startIdx > playRange.endIdx) {
        startIdx = playRange.startIdx;
        setActiveFlatIndex(startIdx);
        activeIdxRef.current = startIdx;
      }

      if (mode === 'wait') {
        const firstPlayable = findNextPlayableIndex(startIdx);
        if (firstPlayable !== null) {
          setActiveFlatIndex(firstPlayable);
          activeIdxRef.current = firstPlayable;
        }
      }

      // На первой доле сразу готовы принять щипок без блокировки
      dspRef.current?.notifyBeatChanged({ isImmediate: true });

      isRunningRef.current = true;
      setIsRunning(true);
      onActiveChange(true);

      if (mode === 'playAlong') {
        startPlayAlongScheduler(activeIdxRef.current);
      }
    } catch (err) {
      stopSession();
      const message =
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Доступ к микрофону запрещен. Разрешите микрофон в настройках.'
          : 'Не удалось запустить микрофон. Проверьте аудиоустройство.';
      setMicError(message);
    }
  };

  const handleRestart = () => {
    stopSession();
    setBeatStatuses({});
    beatStatusesRef.current = {};
    setSessionStats(null);
    const startIdx = playRange.startIdx;
    setActiveFlatIndex(startIdx);
    activeIdxRef.current = startIdx;
    dspRef.current?.notifyBeatChanged({ isImmediate: true });
  };

  const handleModeSwitch = (nextMode: PracticeMode) => {
    if (nextMode === mode) return;
    stopSession();
    setMode(nextMode);
    setSessionStats(null);
  };

  const handleSkipBeat = () => {
    const currIdx = activeFlatIndex;
    setBeatStatuses((prev) => ({ ...prev, [currIdx]: 'skipped' }));
    const nextIdx = findNextPlayableIndex(currIdx + 1);
    if (nextIdx !== null) {
      activeIdxRef.current = nextIdx;
      setActiveFlatIndex(nextIdx);
      dspRef.current?.notifyBeatChanged({ isImmediate: true });
    }
  };

  const handlePreviewCurrentBeat = async () => {
    const ptr = flatBeats[activeFlatIndex];
    if (!ptr || ptr.beat.isRest || ptr.beat.notes.length === 0) return;
    await ensureAudioContextResumed();
    synthRef.current?.scheduleBeatNotes(
      ptr.beat.notes,
      song.tuning.openStringMidi,
      ptr.effectiveCapo
    );
  };

  const handleSelectBeat = useCallback(
    (flatIdx: number) => {
      if (isRunningRef.current && modeRef.current === 'playAlong') {
        stopSession();
      }
      activeIdxRef.current = flatIdx;
      setActiveFlatIndex(flatIdx);
      setSessionStats(null);
      dspRef.current?.notifyBeatChanged({ isImmediate: true });

      if (synthGuideRef.current && !isRunningRef.current) {
        const ptr = flatBeatsRef.current[flatIdx];
        if (ptr && !ptr.beat.isRest && ptr.beat.notes.length > 0) {
          void ensureAudioContextResumed().then(() => {
            synthRef.current?.scheduleBeatNotes(
              ptr.beat.notes,
              song.tuning.openStringMidi,
              ptr.effectiveCapo
            );
          });
        }
      }
    },
    [song.tuning.openStringMidi, stopSession]
  );

  const handleNoiseGateChange = (val: number) => {
    setNoiseGateValue(val);
    dspRef.current?.setNoiseGateThreshold(val);
    try {
      localStorage.setItem(GATE_STORAGE_KEY, String(val));
    } catch {
      // ignore
    }
  };

  const handleSlapSensitivityChange = (val: number) => {
    setSlapSensitivity(val);
    dspRef.current?.setSlapSensitivity(val);
    try {
      localStorage.setItem(SLAP_STORAGE_KEY, String(val));
    } catch {
      // ignore
    }
  };

  const handleDifficultyChange = (nextDifficulty: PracticeDifficulty) => {
    setDifficulty(nextDifficulty);
    dspRef.current?.setDifficulty(nextDifficulty);
    try {
      localStorage.setItem(DIFFICULTY_STORAGE_KEY, nextDifficulty);
    } catch {
      // ignore
    }
  };

  const handleAutoSlapToggle = (enabled: boolean) => {
    setAutoSlapEnabled(enabled);
    dspRef.current?.setAutoSlapEnabled(enabled);
    try {
      localStorage.setItem(AUTO_SLAP_STORAGE_KEY, String(enabled));
    } catch {
      // ignore
    }
  };

  const handleCycleSpeed = () => {
    const idx = SPEED_PRESETS.indexOf(speedPercent);
    const next = SPEED_PRESETS[(idx + 1) % SPEED_PRESETS.length];
    setSpeedPercent(next);
  };

  const activePointer: FlatBeatPointer | undefined = flatBeats[activeFlatIndex];
  const currentEffectiveCapo = activePointer
    ? activePointer.effectiveCapo
    : Math.max(0, Math.min(12, song.capo + manualCapoOffset));
  const currentEffectiveBpm = Math.round(
    (activePointer?.effectiveBpm || song.bpm) * (speedPercent / 100)
  );

  const expectedSummary = useMemo(() => {
    if (!activePointer || activePointer.beat.isRest || activePointer.beat.notes.length === 0) {
      return { kind: 'Пауза', detail: '—', hasSlap: false };
    }
    const notes = activePointer.beat.notes;
    const hasSlap = notes.some((n) => n.technique === 'slap' || n.fret < 0);
    const labels = notes
      .map((n) =>
        computeNoteTargetMidi(
          n,
          song.tuning.openStringMidi,
          activePointer.effectiveCapo
        )
      )
      .filter((m): m is number => m !== null)
      .map((m) => midiToLabel(m));

    if (hasSlap && labels.length === 0) {
      return { kind: 'Щелчок X', detail: 'Удар по струнам', hasSlap: true };
    }
    if (hasSlap && labels.length > 0) {
      return { kind: 'Щелчок + Нота', detail: `X + ${labels.join(' ')}`, hasSlap: true };
    }
    if (labels.length > 1) {
      return { kind: 'Аккорд', detail: labels.join(' · '), hasSlap: false };
    }
    return { kind: 'Нота', detail: labels[0] || '—', hasSlap: false };
  }, [activePointer, song.tuning.openStringMidi]);

  const inputMeterPercent = Math.min(100, Math.round((liveEval.rms / 0.14) * 100));
  const slapMeterPercent = Math.min(100, Math.round(liveEval.slapImpulse * 100));
  const isSlapFlashing = performance.now() < slapFlashUntil;

  return (
    <div className="flex flex-col gap-3.5 w-full max-w-4xl mx-auto">
      {/* 1. Верхняя панель трека (в режиме «Фокус» заменяется минималистичной полосой) */}
      {!isFocusMode ? (
        <div className="space-y-2 pb-2 border-b border-[#262626]">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                stopSession();
                onBackToLibrary();
              }}
              className="min-h-[40px] px-2 -ml-2 rounded-xl hover:bg-[#141414] flex items-center gap-1 text-xs font-medium text-[#8E8E93] hover:text-[#FAFAFA] transition-colors cursor-pointer shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Табы</span>
            </button>

            <div className="min-w-0 text-center flex-1 px-1">
              <div className="text-sm font-semibold text-[#FAFAFA] truncate">
                {song.title}
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setIsFocusMode(true)}
                className="min-h-[40px] px-2.5 rounded-xl bg-[#141414] border border-[#262626] hover:border-[#3F3F46] text-[#8E8E93] hover:text-[#FAFAFA] text-xs font-medium flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                title="Скрыть лишние панели на время игры"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Фокус</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  stopSession();
                  onTuneForSong(song);
                }}
                className="min-h-[40px] px-2.5 rounded-xl bg-[#10B981]/12 border border-[#10B981]/45 hover:bg-[#10B981]/20 text-[#10B981] text-xs font-semibold flex items-center gap-1 whitespace-nowrap cursor-pointer"
              >
                <Gauge className="w-3.5 h-3.5" />
                <span>Настроить</span>
              </button>
            </div>
          </div>

          {/* Тихие метаданные без лишних рамок и «таблеток» */}
          <div className="flex items-center justify-between gap-2 text-xs font-mono tabular-nums text-[#8E8E93]">
            <div className="flex items-center gap-1.5 min-w-0 truncate">
              <span className="text-[#FAFAFA] font-medium truncate">
                {song.tuning.name}
              </span>
              <span aria-hidden="true">·</span>
              <span className={currentEffectiveCapo > 0 ? 'text-[#F59E0B] font-semibold' : ''}>
                Капо {currentEffectiveCapo}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Такт {activePointer?.measureNumber || 1}/{totalMeasures}
              </span>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setManualCapoOffset((prev) => Math.max(-song.capo, prev - 1))}
                className="min-h-[32px] min-w-[32px] rounded-lg bg-[#141414] border border-[#262626] flex items-center justify-center text-[#8E8E93] hover:text-[#FAFAFA] cursor-pointer"
                aria-label="Уменьшить каподастр"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setManualCapoOffset((prev) => Math.min(12 - song.capo, prev + 1))}
                className="min-h-[32px] min-w-[32px] rounded-lg bg-[#141414] border border-[#262626] flex items-center justify-center text-[#8E8E93] hover:text-[#FAFAFA] cursor-pointer"
                aria-label="Увеличить каподастр"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-[#262626]">
          <div className="min-w-0 flex items-center gap-2 text-xs">
            <span className="font-semibold text-[#FAFAFA] truncate">
              {song.title}
            </span>
            <span className="text-[#52525B]" aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-[#8E8E93] shrink-0">
              Такт {activePointer?.measureNumber || 1}/{totalMeasures}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsFocusMode(false)}
            className="min-h-[36px] px-2.5 rounded-xl bg-[#141414] border border-[#262626] text-[#FAFAFA] text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Minimize2 className="w-3.5 h-3.5 text-[#10B981]" />
            <span>Панели</span>
          </button>
        </div>
      )}

      {/* Ошибка микрофона (если есть) */}
      {micError && (
        <div className="px-3.5 py-2.5 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/40 flex items-center gap-2 text-xs text-[#EF4444]">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{micError}</span>
        </div>
      )}

      {/* 2. Главный центр — полноразмерный 6-струнный SVG-холст (никогда не обрезается!) */}
      <TabCanvasRenderer
        song={song}
        flatBeats={flatBeats}
        activeFlatIndex={activeFlatIndex}
        beatStatuses={beatStatuses}
        loopEnabled={loopEnabled}
        loopStartMeasure={loopStartMeasure}
        loopEndMeasure={loopEndMeasure}
        onSelectBeat={handleSelectBeat}
      />

      {/* 3. Компактная строка живого DSP-анализа и кнопка калибровки */}
      <div className="rounded-2xl bg-[#141414] border border-[#262626] px-3.5 py-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`text-xs font-medium whitespace-nowrap ${
              expectedSummary.hasSlap ? 'text-[#F59E0B]' : 'text-[#8E8E93]'
            }`}
          >
            {expectedSummary.kind}:
          </span>
          <span className="font-mono tabular-nums text-sm font-bold text-[#FAFAFA] truncate">
            {expectedSummary.detail}
          </span>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <div className="font-mono tabular-nums text-xs">
            {isRunning ? (
              liveEval.matched ? (
                <span className="text-[#10B981] font-semibold">
                  ✓ {liveEval.detectedLabel}
                </span>
              ) : isSlapFlashing ? (
                <span className="text-[#F59E0B] font-semibold">⚡ X</span>
              ) : liveEval.waitingForAttack ? (
                <span className="text-[#8E8E93]">Ждем щипок</span>
              ) : liveEval.isWrongPitch && liveEval.detectedLabel ? (
                <span className="text-[#EF4444]">{liveEval.detectedLabel}</span>
              ) : liveEval.detectedLabel ? (
                <span className="text-[#F59E0B]">{liveEval.detectedLabel}</span>
              ) : (
                <span className="text-[#52525B]">Слушаю</span>
              )
            ) : (
              <span className="text-[#52525B]">Пауза</span>
            )}
          </div>

          <div className="w-11 h-1.5 rounded-full bg-[#0A0A0A] border border-[#262626] overflow-hidden">
            <div
              className={`h-full transition-all duration-75 ${
                isSlapFlashing
                  ? 'bg-[#F59E0B]'
                  : liveEval.rms >= noiseGateValue
                  ? 'bg-[#10B981]'
                  : 'bg-[#3F3F46]'
              }`}
              style={{ width: `${inputMeterPercent}%` }}
            />
          </div>

          <button
            type="button"
            onClick={() => setIsSettingsSheetOpen(true)}
            className={`min-h-[38px] min-w-[38px] px-2 rounded-xl border flex items-center justify-center gap-1.5 text-xs font-medium transition-colors cursor-pointer ${
              isSettingsSheetOpen
                ? 'bg-[#1C1C1C] border-[#10B981] text-[#10B981]'
                : 'bg-[#0A0A0A] border-[#262626] text-[#8E8E93] hover:text-[#FAFAFA]'
            }`}
            title="Калибровка щелчка (X), порога шума, скорости и петли A–B"
            aria-label="Калибровка"
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span className="hidden sm:inline">Калибровка</span>
          </button>
        </div>
      </div>

      {/* 4. Панель управления (в режиме «Фокус» остаются только главные кнопки действия) */}
      <div className="space-y-3">
        {!isFocusMode && (
          <>
            {/* Режимы: «Шаг за шагом» | «Под темп» */}
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-[#141414] border border-[#262626]">
              <button
                type="button"
                onClick={() => handleModeSwitch('wait')}
                className={`min-h-[44px] px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                  mode === 'wait'
                    ? 'bg-[#0A0A0A] text-[#10B981] border border-[#10B981]/50'
                    : 'text-[#8E8E93] hover:text-[#FAFAFA]'
                }`}
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Шаг за шагом</span>
              </button>

              <button
                type="button"
                onClick={() => handleModeSwitch('playAlong')}
                className={`min-h-[44px] px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                  mode === 'playAlong'
                    ? 'bg-[#0A0A0A] text-[#10B981] border border-[#10B981]/50'
                    : 'text-[#8E8E93] hover:text-[#FAFAFA]'
                }`}
              >
                <Play className="w-4 h-4 shrink-0" />
                <span className="font-mono tabular-nums">
                  Темп · {currentEffectiveBpm}
                </span>
              </button>
            </div>

            {/* Однострочная лента быстрых инструментов разбора */}
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={handleCycleSpeed}
                className="min-h-[44px] px-2 rounded-xl bg-[#141414] border border-[#262626] hover:border-[#3F3F46] font-mono tabular-nums text-xs font-semibold text-[#FAFAFA] flex items-center justify-center cursor-pointer"
                title="Скорость (нажмите для смены 50/75/100%)"
              >
                {speedPercent}%
              </button>

              <button
                type="button"
                onClick={() => setIsSettingsSheetOpen(true)}
                className={`min-h-[44px] px-2 rounded-xl border text-xs font-medium flex items-center justify-center gap-1 cursor-pointer transition-colors ${
                  loopEnabled
                    ? 'bg-[#10B981]/15 border-[#10B981] text-[#10B981]'
                    : 'bg-[#141414] border-[#262626] text-[#8E8E93]'
                }`}
                title="Настройка петли A–B"
              >
                <Repeat className="w-3.5 h-3.5 shrink-0" />
                <span className="font-mono tabular-nums truncate">
                  {loopEnabled ? `${loopStartMeasure}-${loopEndMeasure}` : 'A–B'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setSynthGuideEnabled((prev) => !prev)}
                className={`min-h-[44px] px-2 rounded-xl border text-xs font-medium flex items-center justify-center gap-1 cursor-pointer transition-colors ${
                  synthGuideEnabled
                    ? 'bg-[#141414] border-[#10B981]/50 text-[#FAFAFA]'
                    : 'bg-[#141414] border-[#262626] text-[#8E8E93]'
                }`}
                title="Звуковой гид (синтезатор гитары)"
              >
                {synthGuideEnabled ? (
                  <Volume2 className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
                ) : (
                  <VolumeX className="w-3.5 h-3.5 text-[#52525B] shrink-0" />
                )}
                <span className="truncate">Гид</span>
              </button>

              <button
                type="button"
                onClick={() => setMetronomeEnabled((prev) => !prev)}
                className={`min-h-[44px] px-2 rounded-xl border text-xs font-medium flex items-center justify-center gap-1 cursor-pointer transition-colors ${
                  metronomeEnabled
                    ? 'bg-[#141414] border-[#10B981]/50 text-[#FAFAFA]'
                    : 'bg-[#141414] border-[#262626] text-[#8E8E93]'
                }`}
                title="Клик метронома в режиме Под темп"
              >
                {metronomeEnabled ? (
                  <Bell className="w-3.5 h-3.5 text-[#10B981] shrink-0" />
                ) : (
                  <BellOff className="w-3.5 h-3.5 text-[#52525B] shrink-0" />
                )}
                <span className="truncate">Клик</span>
              </button>
            </div>
          </>
        )}

        {/* Главный ряд кнопок действия */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRestart}
            className="min-h-[52px] min-w-[52px] rounded-2xl bg-[#141414] border border-[#262626] hover:border-[#3F3F46] flex items-center justify-center text-[#8E8E93] hover:text-[#FAFAFA] cursor-pointer"
            title="В начало"
            aria-label="В начало"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleToggleStart}
            className={`flex-1 min-h-[52px] rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.99] cursor-pointer ${
              isRunning
                ? 'bg-[#141414] border border-[#EF4444]/60 text-[#FAFAFA]'
                : 'bg-[#10B981] text-[#0A0A0A] hover:bg-[#059669] shadow-lg shadow-[#10B981]/15'
            }`}
          >
            {isRunning ? (
              <>
                <Pause className="w-4 h-4 text-[#EF4444]" />
                <span>Пауза</span>
              </>
            ) : (
              <>
                <Mic className="w-4 h-4" />
                <span>{mode === 'wait' ? 'Начать разбор' : 'Играть под темп'}</span>
              </>
            )}
          </button>

          {mode === 'wait' ? (
            <button
              type="button"
              onClick={handleSkipBeat}
              className="min-h-[52px] px-3.5 rounded-2xl bg-[#141414] border border-[#262626] hover:border-[#3F3F46] flex items-center justify-center gap-1.5 text-xs font-medium text-[#FAFAFA] cursor-pointer whitespace-nowrap"
              title="Пропустить текущую долю"
            >
              <SkipForward className="w-4 h-4 text-[#8E8E93]" />
              <span className="hidden sm:inline">Пропуск</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handlePreviewCurrentBeat}
              className="min-h-[52px] min-w-[52px] rounded-2xl bg-[#141414] border border-[#262626] hover:border-[#10B981] flex items-center justify-center text-[#10B981] cursor-pointer"
              title="Послушать текущую ноту"
              aria-label="Послушать текущую ноту"
            >
              <Volume2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* === Выдвижная шторка калибровки щелчка (X), Noise Gate, скорости и петли A–B === */}
      {isSettingsSheetOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm"
          onClick={() => setIsSettingsSheetOpen(false)}
        >
          <div
            className="w-full max-w-md max-h-[88dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-[#141414] border-t sm:border border-[#262626] p-5 pb-safe space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#262626] pb-3">
              <div>
                <h3 className="text-sm font-semibold text-[#FAFAFA]">
                  Калибровка и инструменты разбора
                </h3>
                <p className="text-[11px] text-[#8E8E93]">
                  Режим распознавания, щелчок (X), порог шума и петля
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSettingsSheetOpen(false)}
                className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-[#8E8E93] hover:text-[#FAFAFA] cursor-pointer"
                aria-label="Закрыть настройки"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 0. Режим строгости распознавания (Аркадный / Средний / Профи) */}
            <div className="p-3.5 rounded-2xl bg-[#0A0A0A] border border-[#262626] space-y-2.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-medium text-[#FAFAFA]">
                  Строгость распознавания
                </span>
                <span className="text-[11px] font-medium text-[#10B981]">
                  {DIFFICULTY_OPTIONS.find((o) => o.id === difficulty)?.label}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#141414] border border-[#262626]">
                {DIFFICULTY_OPTIONS.map((opt) => {
                  const isActive = difficulty === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleDifficultyChange(opt.id)}
                      className={`min-h-[44px] px-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                        isActive
                          ? 'bg-[#10B981] text-[#0A0A0A]'
                          : 'text-[#8E8E93] hover:text-[#FAFAFA]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              <p className="text-[11px] text-[#8E8E93] leading-relaxed">
                {DIFFICULTY_OPTIONS.find((o) => o.id === difficulty)?.hint}
              </p>
            </div>

            {/* 1. Автоопределение щелчка (X) + живой тест импульса */}
            <div className="p-3.5 rounded-2xl bg-[#0A0A0A] border border-[#262626] space-y-3">
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5 font-medium text-[#FAFAFA]">
                  <Zap className="w-3.5 h-3.5 text-[#F59E0B]" />
                  <span>Щелчок по струне (X)</span>
                </div>

                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#141414] border border-[#262626]">
                  <button
                    type="button"
                    onClick={() => handleAutoSlapToggle(true)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                      autoSlapEnabled
                        ? 'bg-[#10B981] text-[#0A0A0A]'
                        : 'text-[#8E8E93] hover:text-[#FAFAFA]'
                    }`}
                  >
                    Авто
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAutoSlapToggle(false)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                      !autoSlapEnabled
                        ? 'bg-[#1C1C1C] text-[#F59E0B]'
                        : 'text-[#8E8E93] hover:text-[#FAFAFA]'
                    }`}
                  >
                    Вручную
                  </button>
                </div>
              </div>

              {autoSlapEnabled ? (
                <div className="text-[11px] text-[#8E8E93] leading-relaxed">
                  {liveEval.autoSlapCalibrated
                    ? 'Автоподстройка адаптирована под громкость вашей гитары и комнаты.'
                    : 'Автоматически подстраивается под шум комнаты и силу игры — ничего настраивать не нужно.'}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[#8E8E93]">Ручная чувствительность</span>
                    <span className="font-mono tabular-nums font-semibold text-[#F59E0B]">
                      {Math.round(slapSensitivity * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.05}
                    max={1.0}
                    step={0.05}
                    value={slapSensitivity}
                    onChange={(e) =>
                      handleSlapSensitivityChange(parseFloat(e.target.value))
                    }
                    className="w-full te-slider"
                    aria-label="Чувствительность щелчка X"
                  />
                </div>
              )}

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[#8E8E93]">
                    {isRunning
                      ? 'Сделайте щелчок по струнам для проверки'
                      : 'Включите разбор, чтобы увидеть импульс'}
                  </span>
                  {isSlapFlashing && (
                    <span className="font-semibold text-[#10B981]">
                      Щелчок пойман!
                    </span>
                  )}
                </div>
                <div className="h-2 rounded-full bg-[#141414] border border-[#262626] overflow-hidden">
                  <div
                    className={`h-full transition-all duration-75 ${
                      isSlapFlashing ? 'bg-[#10B981]' : 'bg-[#F59E0B]'
                    }`}
                    style={{ width: `${slapMeterPercent}%` }}
                  />
                </div>
              </div>
            </div>

            {/* 2. Порог шума (Noise Gate) */}
            <div className="p-3.5 rounded-2xl bg-[#0A0A0A] border border-[#262626] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#FAFAFA] font-medium">
                  Порог шума (Noise Gate)
                </span>
                <span className="font-mono tabular-nums text-[#8E8E93]">
                  {Math.round(noiseGateValue * 1000)} мВ
                </span>
              </div>
              <input
                type="range"
                min={0.003}
                max={0.05}
                step={0.001}
                value={noiseGateValue}
                onChange={(e) => handleNoiseGateChange(parseFloat(e.target.value))}
                className="w-full te-slider"
                aria-label="Порог шума"
              />
            </div>

            {/* 3. Точная скорость (25% – 100%) */}
            <div className="p-3.5 rounded-2xl bg-[#0A0A0A] border border-[#262626] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#FAFAFA] font-medium">Скорость темпа</span>
                <span className="font-mono tabular-nums text-[#10B981] font-semibold">
                  {speedPercent}% ({currentEffectiveBpm} BPM)
                </span>
              </div>
              <input
                type="range"
                min={25}
                max={100}
                step={5}
                value={speedPercent}
                onChange={(e) => setSpeedPercent(Number(e.target.value))}
                className="w-full te-slider"
                aria-label="Скорость темпа"
              />
              <div className="grid grid-cols-3 gap-1.5">
                {SPEED_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setSpeedPercent(p)}
                    className={`min-h-[38px] rounded-xl font-mono text-xs font-semibold border cursor-pointer ${
                      speedPercent === p
                        ? 'bg-[#10B981]/15 border-[#10B981] text-[#10B981]'
                        : 'bg-[#141414] border-[#262626] text-[#8E8E93]'
                    }`}
                  >
                    {p}%
                  </button>
                ))}
              </div>
            </div>

            {/* 4. Петля (A–B Loop) */}
            <div className="p-3.5 rounded-2xl bg-[#0A0A0A] border border-[#262626] flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setLoopEnabled((prev) => !prev)}
                className={`min-h-[42px] px-3 rounded-xl border text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                  loopEnabled
                    ? 'bg-[#10B981]/15 border-[#10B981] text-[#10B981]'
                    : 'bg-[#141414] border-[#262626] text-[#8E8E93]'
                }`}
              >
                <Repeat className="w-3.5 h-3.5" />
                <span>Петля A–B</span>
              </button>

              <div className="flex items-center gap-1.5 font-mono tabular-nums text-xs">
                <span className="text-[#8E8E93]">Такты</span>
                <select
                  aria-label="Начальный такт петли"
                  value={loopStartMeasure}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setLoopStartMeasure(val);
                    if (val > loopEndMeasure) setLoopEndMeasure(val);
                    setLoopEnabled(true);
                  }}
                  className="min-h-[40px] px-2.5 rounded-xl bg-[#141414] border border-[#262626] text-[#FAFAFA]"
                >
                  {song.measures.map((m) => (
                    <option key={m.index} value={m.index}>
                      {m.index}
                    </option>
                  ))}
                </select>
                <span className="text-[#52525B]">–</span>
                <select
                  aria-label="Конечный такт петли"
                  value={loopEndMeasure}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setLoopEndMeasure(val);
                    if (val < loopStartMeasure) setLoopStartMeasure(val);
                    setLoopEnabled(true);
                  }}
                  className="min-h-[40px] px-2.5 rounded-xl bg-[#141414] border border-[#262626] text-[#FAFAFA]"
                >
                  {song.measures.map((m) => (
                    <option key={m.index} value={m.index}>
                      {m.index}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsSettingsSheetOpen(false)}
              className="w-full min-h-[48px] rounded-2xl bg-[#10B981] text-[#0A0A0A] text-sm font-semibold cursor-pointer"
            >
              Готово
            </button>
          </div>
        </div>
      )}

      {/* === Всплывающий экран статистики по завершении прохода === */}
      {sessionStats && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
          onClick={() => setSessionStats(null)}
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-[#141414] border border-[#10B981]/60 p-5 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Trophy className="w-5 h-5 text-[#10B981]" />
                <div>
                  <div className="text-sm font-semibold text-[#FAFAFA]">
                    Результат прохода
                  </div>
                  <div className="text-xs text-[#8E8E93]">
                    {sessionStats.isNewBest
                      ? 'Новый личный рекорд'
                      : `Лучший: ${song.bestAccuracy ?? sessionStats.accuracy}%`}
                  </div>
                </div>
              </div>
              <div className="font-mono tabular-nums text-3xl font-bold text-[#10B981]">
                {sessionStats.accuracy}%
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2.5 rounded-2xl bg-[#0A0A0A] border border-[#262626]">
                <div className="font-mono tabular-nums text-base font-bold text-[#10B981]">
                  {sessionStats.hits}
                </div>
                <div className="text-[11px] text-[#8E8E93]">Точно</div>
              </div>
              <div className="p-2.5 rounded-2xl bg-[#0A0A0A] border border-[#262626]">
                <div className="font-mono tabular-nums text-base font-bold text-[#EF4444]">
                  {sessionStats.wrongs}
                </div>
                <div className="text-[11px] text-[#8E8E93]">Ошибки</div>
              </div>
              <div className="p-2.5 rounded-2xl bg-[#0A0A0A] border border-[#262626]">
                <div className="font-mono tabular-nums text-base font-bold text-[#8E8E93]">
                  {sessionStats.missed}
                </div>
                <div className="text-[11px] text-[#8E8E93]">Пропущено</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRestart}
                className="flex-1 min-h-[46px] rounded-xl bg-[#10B981] text-[#0A0A0A] text-xs font-semibold cursor-pointer"
              >
                Сыграть еще раз
              </button>
              <button
                type="button"
                onClick={() => setSessionStats(null)}
                className="px-4 min-h-[46px] rounded-xl bg-[#0A0A0A] border border-[#262626] text-xs text-[#8E8E93] hover:text-[#FAFAFA] cursor-pointer"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
