import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  FileCode2,
  FileImage,
  FileMusic,
  Loader2,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { isCapacitorNative } from '../hooks/usePWAInstall';
import type { AlphaTabInspectionResult } from '../parsers/alphaTabParser';
import { SAMPLE_ASCII_TAB, parseAsciiTab } from '../parsers/asciiTabParser';
import type { RenderedPdfPage } from '../parsers/pdfAiImporter';
import { BUILTIN_TUNING_PRESETS } from '../services/tuningStorage';
import { STANDARD_OPEN_MIDI, SongScore } from '../types/tabs';
import { CHROMATIC_NOTES } from '../types/tuning';

interface ImportTabModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: (song: SongScore) => void;
}

type ImportMethodTab = 'alphatab' | 'ascii' | 'pdf-ai';

function tuningPresetToMidi(presetId: string): { name: string; openStringMidi: number[] } {
  const preset = BUILTIN_TUNING_PRESETS.find((p) => p.id === presetId);
  if (!preset) {
    return { name: 'Standard', openStringMidi: [...STANDARD_OPEN_MIDI] };
  }
  const openStringMidi = preset.strings.map((s) => {
    const idx = CHROMATIC_NOTES.indexOf(s.note);
    return (s.octave + 1) * 12 + idx;
  });
  return {
    name: preset.name,
    openStringMidi,
  };
}

export const ImportTabModal: React.FC<ImportTabModalProps> = ({
  isOpen,
  onClose,
  onImportSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<ImportMethodTab>('alphatab');

  // --- Состояние вкладки 1: Guitar Pro / MusicXML (alphaTab headless) ---
  const [gpFileName, setGpFileName] = useState<string>('');
  const [gpBytes, setGpBytes] = useState<Uint8Array | null>(null);
  const [gpInspection, setGpInspection] = useState<AlphaTabInspectionResult | null>(null);
  const [selectedTrackIndex, setSelectedTrackIndex] = useState<number>(0);
  const [gpError, setGpError] = useState<string | null>(null);
  const [isParsingGp, setIsParsingGp] = useState(false);

  // --- Состояние вкладки 2: Текстовые ASCII табы ---
  const [asciiTitle, setAsciiTitle] = useState('');
  const [asciiArtist, setAsciiArtist] = useState('');
  const [asciiBpm, setAsciiBpm] = useState(96);
  const [asciiTuningId, setAsciiTuningId] = useState('standard');
  const [asciiCapo, setAsciiCapo] = useState(0);
  const [asciiText, setAsciiText] = useState('');
  const [asciiError, setAsciiError] = useState<string | null>(null);

  // --- Состояние вкладки 3: PDF / Скриншот (AI-импорт) ---
  const [pdfFileName, setPdfFileName] = useState('');
  const [renderedPages, setRenderedPages] = useState<RenderedPdfPage[]>([]);
  const [selectedPageNums, setSelectedPageNums] = useState<number[]>([]);
  const [isRenderingPdf, setIsRenderingPdf] = useState(false);
  const [isAiExtracting, setIsAiExtracting] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const asciiLiveStats = useMemo(() => {
    if (!asciiText.trim()) return null;
    try {
      const preview = parseAsciiTab(asciiText, {
        title: asciiTitle || 'Preview',
        bpm: asciiBpm,
        tuning: tuningPresetToMidi(asciiTuningId),
        capo: asciiCapo,
      });
      const totalBeats = preview.measures.reduce((acc, m) => acc + m.beats.length, 0);
      return {
        measures: preview.measures.length,
        beats: totalBeats,
      };
    } catch {
      return null;
    }
  }, [asciiText, asciiTitle, asciiBpm, asciiTuningId, asciiCapo]);

  if (!isOpen) return null;

  const handleGpFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputEl = e.currentTarget;
    const file = inputEl.files?.[0];
    if (!file) return;

    setGpError(null);
    setIsParsingGp(true);
    setGpFileName(file.name);

    try {
      const lowerName = file.name.toLowerCase();
      const dotIdx = lowerName.lastIndexOf('.');
      const ext = dotIdx >= 0 ? lowerName.slice(dotIdx) : '';

      const unsupportedMedia = [
        '.pdf',
        '.png',
        '.jpg',
        '.jpeg',
        '.webp',
        '.gif',
        '.mp3',
        '.wav',
        '.ogg',
        '.m4a',
        '.mp4',
        '.mov',
        '.txt',
        '.doc',
        '.docx',
        '.apk',
      ];
      if (ext && unsupportedMedia.includes(ext)) {
        if (ext === '.pdf' || ['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
          throw new Error(
            'Для PDF и скриншотов переключитесь на вкладку «PDF / AI» сверху.'
          );
        }
        throw new Error(
          `Формат «${ext}» не является табулатурой Guitar Pro или MusicXML.`
        );
      }

      const [{ inspectAlphaTabFile }, buffer] = await Promise.all([
        import('../parsers/alphaTabParser'),
        file.arrayBuffer(),
      ]);
      const bytes = new Uint8Array(buffer);
      const inspection = inspectAlphaTabFile(bytes);

      if (inspection.tracks.length === 0) {
        throw new Error('В файле не найдено музыкальных дорожек.');
      }

      const firstGuitarIdx = inspection.tracks.findIndex((t) => !t.isPercussion);
      setGpBytes(bytes);
      setGpInspection(inspection);
      setSelectedTrackIndex(firstGuitarIdx >= 0 ? firstGuitarIdx : 0);
    } catch (err) {
      setGpBytes(null);
      setGpInspection(null);
      setGpError(
        err instanceof Error
          ? err.message
          : 'Не удалось прочитать файл. Выберите файл .gp, .gp3, .gp4, .gp5, .gpx, .xml или .mxl.'
      );
    } finally {
      setIsParsingGp(false);
      inputEl.value = '';
    }
  };

  const handleConfirmGpImport = async () => {
    if (!gpBytes) return;
    setGpError(null);
    try {
      const { extractAlphaTabTrack } = await import('../parsers/alphaTabParser');
      const song = extractAlphaTabTrack(gpBytes, selectedTrackIndex, gpFileName);
      onImportSuccess(song);
      onClose();
    } catch (err) {
      setGpError(
        err instanceof Error ? err.message : 'Ошибка извлечения выбранной дорожки.'
      );
    }
  };

  const handleImportAscii = (e: React.FormEvent) => {
    e.preventDefault();
    setAsciiError(null);
    try {
      const song = parseAsciiTab(asciiText, {
        title: asciiTitle || 'Текстовый таб',
        artist: asciiArtist || 'ASCII Import',
        bpm: asciiBpm,
        tuning: tuningPresetToMidi(asciiTuningId),
        capo: asciiCapo,
      });
      onImportSuccess(song);
      onClose();
    } catch (err) {
      setAsciiError(
        err instanceof Error ? err.message : 'Ошибка разбора ASCII-табулатуры.'
      );
    }
  };

  const handlePdfOrImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputEl = e.currentTarget;
    const file = inputEl.files?.[0];
    if (!file) return;

    setAiError(null);
    setIsRenderingPdf(true);
    setPdfFileName(file.name);
    setRenderedPages([]);
    setSelectedPageNums([]);

    try {
      const { renderPdfToImages, readImageFileAsPage } = await import(
        '../parsers/pdfAiImporter'
      );
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const pages = await renderPdfToImages(file, 4);
        if (pages.length === 0) {
          throw new Error('Не удалось отрендерить страницы PDF.');
        }
        setRenderedPages(pages);
        setSelectedPageNums(pages.slice(0, 2).map((p) => p.pageNumber));
      } else {
        const page = await readImageFileAsPage(file);
        setRenderedPages([page]);
        setSelectedPageNums([1]);
      }
    } catch (err) {
      setAiError(
        err instanceof Error
          ? err.message
          : 'Не удалось загрузить PDF или изображение.'
      );
    } finally {
      setIsRenderingPdf(false);
      inputEl.value = '';
    }
  };

  const togglePageSelection = (pageNumber: number) => {
    setSelectedPageNums((prev) =>
      prev.includes(pageNumber)
        ? prev.filter((p) => p !== pageNumber)
        : [...prev, pageNumber].sort((a, b) => a - b)
    );
  };

  const handleRunAiExtract = async () => {
    const chosen = renderedPages.filter((p) =>
      selectedPageNums.includes(p.pageNumber)
    );
    if (chosen.length === 0) {
      setAiError('Выберите хотя бы одну страницу для распознавания.');
      return;
    }

    if (isCapacitorNative()) {
      setAiError(
        'AI-распознавание фото и PDF требует серверного подключения и недоступно в автономном APK. Используйте офлайн-вкладки «GP / XML» или «ASCII Текст».'
      );
      return;
    }

    setAiError(null);
    setIsAiExtracting(true);
    try {
      const { parseTabImagesWithAI } = await import('../parsers/pdfAiImporter');
      const cleanName = pdfFileName.replace(/\.(pdf|png|jpg|jpeg|webp)$/i, '');
      const song = await parseTabImagesWithAI(chosen, cleanName || 'AI Табулатура');
      onImportSuccess(song);
      onClose();
    } catch (err) {
      setAiError(
        err instanceof Error
          ? err.message
          : 'Ошибка AI-импорта. Попробуйте .gp5/.gpx или ASCII-табы.'
      );
    } finally {
      setIsAiExtracting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-[#141414] border-t sm:border border-[#262626] shadow-2xl overflow-hidden pb-safe"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1.5 bg-[#262626] rounded-full mx-auto mt-3 mb-1 shrink-0" />

        {/* Шапка модалки */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#262626] shrink-0">
          <div>
            <h2 className="text-base font-semibold text-[#FAFAFA]">
              Добавить табулатуру
            </h2>
            <p className="text-xs text-[#8E8E93]">
              Guitar Pro / MusicXML, текстовый ASCII или AI-импорт PDF
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-[#8E8E93] hover:text-[#FAFAFA] cursor-pointer"
            aria-label="Закрыть"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Переключатель 3 способов импорта */}
        <div className="px-5 pt-4 shrink-0">
          <div className="grid grid-cols-3 gap-1.5 p-1 rounded-2xl bg-[#0A0A0A] border border-[#262626]">
            <button
              type="button"
              onClick={() => setActiveTab('alphatab')}
              className={`min-h-[42px] px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                activeTab === 'alphatab'
                  ? 'bg-[#1C1C1C] text-[#10B981] border border-[#10B981]/50'
                  : 'text-[#8E8E93] hover:text-[#FAFAFA]'
              }`}
            >
              <FileMusic className="w-3.5 h-3.5 shrink-0" />
              <span>GP / XML</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('ascii')}
              className={`min-h-[42px] px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                activeTab === 'ascii'
                  ? 'bg-[#1C1C1C] text-[#10B981] border border-[#10B981]/50'
                  : 'text-[#8E8E93] hover:text-[#FAFAFA]'
              }`}
            >
              <FileCode2 className="w-3.5 h-3.5 shrink-0" />
              <span>ASCII Текст</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('pdf-ai')}
              className={`min-h-[42px] px-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                activeTab === 'pdf-ai'
                  ? 'bg-[#1C1C1C] text-[#10B981] border border-[#10B981]/50'
                  : 'text-[#8E8E93] hover:text-[#FAFAFA]'
              }`}
            >
              <FileImage className="w-3.5 h-3.5 shrink-0" />
              <span>PDF / AI</span>
            </button>
          </div>
        </div>

        {/* Контент активной вкладки */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* === 1. Guitar Pro / MusicXML (Headless alphaTab) === */}
          {activeTab === 'alphatab' && (
            <div className="space-y-4">
              <label className="block rounded-2xl border border-dashed border-[#3F3F46] hover:border-[#10B981] bg-[#0A0A0A] p-6 text-center transition-colors cursor-pointer">
                <input
                  type="file"
                  onChange={handleGpFileChange}
                  className="hidden"
                />
                <div className="w-11 h-11 rounded-2xl bg-[#141414] border border-[#262626] flex items-center justify-center mx-auto mb-3 text-[#10B981]">
                  {isParsingGp ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Upload className="w-5 h-5" />
                  )}
                </div>
                <div className="text-sm font-semibold text-[#FAFAFA]">
                  {gpFileName || 'Выберите файл Guitar Pro или MusicXML'}
                </div>
                <div className="text-xs text-[#8E8E93] mt-1 font-mono">
                  .gp · .gp3 · .gp4 · .gp5 · .gpx · .xml · .mxl
                </div>
                <div className="text-[11px] text-[#52525B] mt-2">
                  Полностью оффлайн парсинг через headless alphaTab Engine
                </div>
              </label>

              {gpError && (
                <div className="p-3.5 rounded-2xl bg-[#EF4444]/10 border border-[#EF4444]/40 flex items-start gap-2.5 text-xs text-[#EF4444]">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{gpError}</span>
                </div>
              )}

              {gpInspection && (
                <div className="space-y-3">
                  <div className="p-3.5 rounded-2xl bg-[#0A0A0A] border border-[#262626]">
                    <div className="text-sm font-semibold text-[#FAFAFA]">
                      {gpInspection.title}
                    </div>
                    <div className="text-xs text-[#8E8E93] mt-0.5 flex items-center gap-2 font-mono tabular-nums">
                      <span>{gpInspection.artist}</span>
                      <span>·</span>
                      <span>{gpInspection.bpm} BPM</span>
                      <span>·</span>
                      <span>Дорожек: {gpInspection.tracks.length}</span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-xs font-medium text-[#8E8E93]">
                      Выберите гитарную дорожку для разбора:
                    </div>
                    <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                      {gpInspection.tracks.map((track) => {
                        const isSelected = track.index === selectedTrackIndex;
                        return (
                          <button
                            key={track.index}
                            type="button"
                            onClick={() => setSelectedTrackIndex(track.index)}
                            className={`w-full min-h-[54px] px-3.5 py-2.5 rounded-2xl border text-left transition-all flex items-center justify-between cursor-pointer ${
                              isSelected
                                ? 'bg-[#10B981]/12 border-[#10B981]'
                                : 'bg-[#0A0A0A] border-[#262626] hover:border-[#3F3F46]'
                            }`}
                          >
                            <div className="min-w-0 pr-2">
                              <div className="text-sm font-semibold text-[#FAFAFA] truncate">
                                {track.index + 1}. {track.name}
                              </div>
                              <div className="text-xs text-[#8E8E93] font-mono tabular-nums mt-0.5">
                                {track.tuningLabel} · Капо {track.capo} · {track.measureCount} такт.
                              </div>
                            </div>
                            {isSelected && (
                              <Check className="w-4 h-4 text-[#10B981] shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleConfirmGpImport}
                    className="w-full min-h-[50px] rounded-2xl bg-[#10B981] text-[#0A0A0A] text-sm font-semibold hover:bg-[#059669] active:scale-[0.99] transition-all cursor-pointer"
                  >
                    Импортировать выбранную дорожку
                  </button>
                </div>
              )}
            </div>
          )}

          {/* === 2. Текстовые табы (ASCII Paste) === */}
          {activeTab === 'ascii' && (
            <form onSubmit={handleImportAscii} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs text-[#8E8E93] mb-1">
                    Название песни
                  </label>
                  <input
                    type="text"
                    value={asciiTitle}
                    onChange={(e) => setAsciiTitle(e.target.value)}
                    placeholder="Например: Nothing Else Matters"
                    className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#0A0A0A] border border-[#262626] focus:border-[#10B981] focus:outline-none text-sm text-[#FAFAFA] placeholder:text-[#52525B]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#8E8E93] mb-1">
                    Исполнитель
                  </label>
                  <input
                    type="text"
                    value={asciiArtist}
                    onChange={(e) => setAsciiArtist(e.target.value)}
                    placeholder="Автор / Аранжировка"
                    className="w-full min-h-[44px] px-3.5 rounded-xl bg-[#0A0A0A] border border-[#262626] focus:border-[#10B981] focus:outline-none text-sm text-[#FAFAFA] placeholder:text-[#52525B]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs text-[#8E8E93] mb-1">BPM</label>
                  <input
                    type="number"
                    min={30}
                    max={240}
                    value={asciiBpm}
                    onChange={(e) => setAsciiBpm(Number(e.target.value) || 100)}
                    className="w-full min-h-[44px] px-3 rounded-xl bg-[#0A0A0A] border border-[#262626] focus:border-[#10B981] focus:outline-none font-mono tabular-nums text-sm text-[#FAFAFA]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#8E8E93] mb-1">Строй</label>
                  <select
                    value={asciiTuningId}
                    onChange={(e) => setAsciiTuningId(e.target.value)}
                    className="w-full min-h-[44px] px-2.5 rounded-xl bg-[#0A0A0A] border border-[#262626] focus:border-[#10B981] focus:outline-none text-xs text-[#FAFAFA]"
                  >
                    {BUILTIN_TUNING_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[#8E8E93] mb-1">
                    Каподастр
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={12}
                    value={asciiCapo}
                    onChange={(e) => setAsciiCapo(Math.max(0, Math.min(12, Number(e.target.value) || 0)))}
                    className="w-full min-h-[44px] px-3 rounded-xl bg-[#0A0A0A] border border-[#262626] focus:border-[#10B981] focus:outline-none font-mono tabular-nums text-sm text-[#FAFAFA]"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-[#8E8E93]">
                    Вставьте 6-струнный ASCII-таб (h, p, /, x, &lt;12&gt;, |)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setAsciiText(SAMPLE_ASCII_TAB);
                      if (!asciiTitle) setAsciiTitle('Acoustic Groove (ASCII)');
                    }}
                    className="text-xs font-medium text-[#10B981] hover:underline cursor-pointer"
                  >
                    Вставить пример
                  </button>
                </div>
                <textarea
                  rows={8}
                  value={asciiText}
                  onChange={(e) => {
                    setAsciiText(e.target.value);
                    if (asciiError) setAsciiError(null);
                  }}
                  placeholder={`e|---0-----2h3-----0---|\nB|---0---------0---1---|\nG|---0-------------0---|\nD|---2---------x---2---|\nA|---2---------x---3---|\nE|---0---------x-------|`}
                  className="w-full p-3 rounded-2xl bg-[#0A0A0A] border border-[#262626] focus:border-[#10B981] focus:outline-none font-mono text-xs leading-relaxed text-[#FAFAFA] placeholder:text-[#3F3F46] whitespace-pre overflow-x-auto"
                />
                {asciiLiveStats && (
                  <div className="mt-1.5 text-xs font-mono tabular-nums text-[#10B981]">
                    Распознано: {asciiLiveStats.measures} такт. · {asciiLiveStats.beats} долей
                  </div>
                )}
              </div>

              {asciiError && (
                <div className="p-3 rounded-2xl bg-[#EF4444]/10 border border-[#EF4444]/40 flex items-start gap-2 text-xs text-[#EF4444]">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{asciiError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={!asciiText.trim()}
                className="w-full min-h-[50px] rounded-2xl bg-[#10B981] disabled:opacity-40 text-[#0A0A0A] text-sm font-semibold hover:bg-[#059669] active:scale-[0.99] transition-all cursor-pointer"
              >
                Разобрать и сохранить таб
              </button>
            </form>
          )}

          {/* === 3. PDF / Скриншот (Экспериментальный AI-импорт) === */}
          {activeTab === 'pdf-ai' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-2xl bg-[#0A0A0A] border border-[#262626] text-xs text-[#A1A1AA] leading-relaxed">
                <div className="flex items-center gap-1.5 text-[#FAFAFA] font-semibold mb-1">
                  <Sparkles className="w-3.5 h-3.5 text-[#10B981]" />
                  <span>Экспериментальный AI-импорт (PDF и скриншоты)</span>
                </div>
                Страницы PDF рендерятся локально в браузере (pdfjs-dist) и отправляются в серверный AI-распознаватель для извлечения табулатуры. Для полностью оффлайн-работы без сети используйте вкладки{' '}
                <span className="text-[#FAFAFA] font-medium">GP / XML</span> или{' '}
                <span className="text-[#FAFAFA] font-medium">ASCII Текст</span>.
              </div>

              <label className="block rounded-2xl border border-dashed border-[#3F3F46] hover:border-[#10B981] bg-[#0A0A0A] p-6 text-center transition-colors cursor-pointer">
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  onChange={handlePdfOrImageChange}
                  className="hidden"
                />
                <div className="w-11 h-11 rounded-2xl bg-[#141414] border border-[#262626] flex items-center justify-center mx-auto mb-3 text-[#10B981]">
                  {isRenderingPdf ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <FileImage className="w-5 h-5" />
                  )}
                </div>
                <div className="text-sm font-semibold text-[#FAFAFA]">
                  {pdfFileName || 'Загрузите PDF или скриншот табулатуры'}
                </div>
                <div className="text-xs text-[#8E8E93] mt-1 font-mono">
                  .pdf (до 4 стр.) · .png · .jpg · .webp
                </div>
              </label>

              {renderedPages.length > 0 && (
                <div className="space-y-2.5">
                  <div className="text-xs text-[#8E8E93]">
                    Выберите страницы с табулатурой ({selectedPageNums.length} выбрано):
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    {renderedPages.map((page) => {
                      const selected = selectedPageNums.includes(page.pageNumber);
                      return (
                        <button
                          key={page.pageNumber}
                          type="button"
                          onClick={() => togglePageSelection(page.pageNumber)}
                          className={`relative rounded-2xl overflow-hidden border-2 transition-all text-left cursor-pointer ${
                            selected
                              ? 'border-[#10B981]'
                              : 'border-[#262626] opacity-60 hover:opacity-100'
                          }`}
                        >
                          <img
                            src={page.dataUrl}
                            alt={`Страница ${page.pageNumber}`}
                            className="w-full h-32 object-cover object-top bg-white"
                          />
                          <div className="px-2.5 py-1.5 bg-[#0A0A0A] flex items-center justify-between text-xs font-mono">
                            <span className="text-[#FAFAFA]">Стр. {page.pageNumber}</span>
                            {selected && <Check className="w-3.5 h-3.5 text-[#10B981]" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {aiError && (
                <div className="p-3.5 rounded-2xl bg-[#EF4444]/10 border border-[#EF4444]/40 flex items-start gap-2.5 text-xs text-[#EF4444] leading-relaxed">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{aiError}</span>
                </div>
              )}

              {renderedPages.length > 0 && (
                <button
                  type="button"
                  disabled={isAiExtracting || selectedPageNums.length === 0}
                  onClick={handleRunAiExtract}
                  className="w-full min-h-[50px] rounded-2xl bg-[#10B981] disabled:opacity-50 text-[#0A0A0A] text-sm font-semibold hover:bg-[#059669] active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isAiExtracting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Распознаем табулатуру...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>Извлечь таб с помощью AI</span>
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
