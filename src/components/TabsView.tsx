import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import {
  ChevronRight,
  Music2,
  Plus,
  Trash2,
  Trophy,
} from 'lucide-react';
import {
  deleteSong,
  getAllSongs,
  saveSong,
  updateSongBestAccuracy,
} from '../services/songStorage';
import { SongScore } from '../types/tabs';
import { TabPlayerView } from './TabPlayerView';

const ImportTabModal = lazy(() =>
  import('./ImportTabModal').then((m) => ({ default: m.ImportTabModal }))
);

interface TabsViewProps {
  isActiveTab: boolean;
  onTuneForSong: (song: SongScore) => void;
  onPracticeActiveChange: (isActive: boolean) => void;
}

const SOURCE_LABELS: Record<SongScore['source'], string> = {
  demo: 'Демо-этюд',
  alphatab: 'Guitar Pro / XML',
  ascii: 'ASCII Таб',
  'ai-pdf': 'PDF / AI',
};

export const TabsView: React.FC<TabsViewProps> = ({
  isActiveTab,
  onTuneForSong,
  onPracticeActiveChange,
}) => {
  const [songs, setSongs] = useState<SongScore[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);

  const loadLibrary = useCallback(async () => {
    setIsLoading(true);
    const list = await getAllSongs();
    setSongs(list);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  const activeSong = songs.find((s) => s.id === selectedSongId) || null;

  const handleImportSuccess = async (newSong: SongScore) => {
    await saveSong(newSong);
    await loadLibrary();
    setSelectedSongId(newSong.id);
  };

  const handleDeleteSong = async (e: React.MouseEvent, songId: string) => {
    e.stopPropagation();
    await deleteSong(songId);
    if (selectedSongId === songId) {
      setSelectedSongId(null);
    }
    await loadLibrary();
  };

  const handleSaveBestAccuracy = useCallback(
    async (songId: string, accuracy: number) => {
      const updated = await updateSongBestAccuracy(songId, accuracy);
      if (updated) {
        setSongs((prev) =>
          prev.map((s) => (s.id === updated.id ? updated : s))
        );
      }
    },
    []
  );

  // Экран интерактивного плеера-тренажера (Single-Screen 100dvh)
  if (activeSong) {
    return (
      <TabPlayerView
        song={activeSong}
        isVisible={isActiveTab}
        onBackToLibrary={() => {
          onPracticeActiveChange(false);
          setSelectedSongId(null);
        }}
        onTuneForSong={onTuneForSong}
        onSaveBestAccuracy={handleSaveBestAccuracy}
        onActiveChange={onPracticeActiveChange}
      />
    );
  }

  // Экран библиотеки табулатур
  return (
    <div className="flex flex-col gap-4 w-full max-w-4xl mx-auto">
      {/* Чистая шапка библиотеки без лишней внешней рамки */}
      <div className="flex items-center justify-between gap-3 pt-1">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-[#FAFAFA] tracking-tight">
            Табулатуры
          </h1>
          <p className="text-xs text-[#8E8E93] mt-0.5">
            Библиотека · {songs.length} · Офлайн-хранилище
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsImportOpen(true)}
          className="min-h-[44px] px-4 rounded-xl bg-[#10B981] text-[#0A0A0A] text-xs sm:text-sm font-semibold hover:bg-[#059669] active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Добавить</span>
        </button>
      </div>

      {/* Список композиций с естественным скроллом страницы */}
      <div className="space-y-2.5">
        {isLoading ? (
          <div className="rounded-2xl bg-[#141414] border border-[#262626] p-8 text-center text-xs text-[#8E8E93]">
            Загрузка библиотеки табулатур...
          </div>
        ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {songs.map((song) => {
                const totalBeats = song.measures.reduce(
                  (acc, m) => acc + m.beats.length,
                  0
                );

                return (
                  <div
                    key={song.id}
                    onClick={() => setSelectedSongId(song.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedSongId(song.id);
                      }
                    }}
                    className="rounded-2xl bg-[#141414] border border-[#262626] hover:border-[#10B981]/60 active:scale-[0.99] transition-all p-3.5 flex flex-col justify-between gap-2.5 cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-[#0A0A0A] border border-[#262626] flex items-center justify-center shrink-0 text-[#10B981]">
                          <Music2 className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-[#FAFAFA] truncate">
                            {song.title}
                          </div>
                          <div className="text-xs text-[#8E8E93] truncate mt-0.5">
                            {song.artist} · {SOURCE_LABELS[song.source]}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-0.5 shrink-0">
                        {!song.isDemo && (
                          <button
                            type="button"
                            onClick={(e) => handleDeleteSong(e, song.id)}
                            className="min-h-[38px] min-w-[38px] rounded-xl flex items-center justify-center text-[#52525B] hover:text-[#EF4444] hover:bg-[#0A0A0A] transition-colors cursor-pointer"
                            title="Удалить таб"
                            aria-label={`Удалить ${song.title}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                        <div className="min-h-[38px] min-w-[28px] flex items-center justify-center text-[#8E8E93]">
                          <ChevronRight className="w-4 h-4" />
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-[#262626] flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-[#8E8E93]">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="text-[#FAFAFA]">{song.tuning.name}</span>
                        <span>·</span>
                        <span>{song.bpm} BPM</span>
                        {song.capo > 0 && (
                          <>
                            <span>·</span>
                            <span className="text-[#F59E0B]">Капо {song.capo}</span>
                          </>
                        )}
                        <span>·</span>
                        <span>
                          {song.measures.length} такт. ({totalBeats})
                        </span>
                      </div>

                      {typeof song.bestAccuracy === 'number' && (
                        <div className="flex items-center gap-1 text-[#10B981] font-semibold shrink-0">
                          <Trophy className="w-3.5 h-3.5" />
                          <span>{song.bestAccuracy}%</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </div>

      {/* Ленивая модалка добавления таба */}
      {isImportOpen && (
        <Suspense fallback={null}>
          <ImportTabModal
            isOpen={isImportOpen}
            onClose={() => setIsImportOpen(false)}
            onImportSuccess={handleImportSuccess}
          />
        </Suspense>
      )}
    </div>
  );
};
