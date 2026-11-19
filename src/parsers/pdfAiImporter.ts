import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  NoteTechnique,
  STANDARD_OPEN_MIDI,
  SongScore,
  TabBeat,
  TabMeasure,
  TabNote,
  parseCapoFromMarker,
} from '../types/tabs';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface RenderedPdfPage {
  pageNumber: number;
  dataUrl: string;
  base64: string;
  mimeType: string;
}

/**
 * Рендерит до maxPages страниц PDF-файла в PNG-изображения на клиентском Canvas через pdfjs-dist
 */
export async function renderPdfToImages(
  file: File,
  maxPages = 3
): Promise<RenderedPdfPage[]> {
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  const totalToRender = Math.min(pdf.numPages, maxPages);
  const pages: RenderedPdfPage[] = [];

  for (let pageNum = 1; pageNum <= totalToRender; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.6 });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: ctx,
      viewport,
      canvas,
    }).promise;

    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1] || '';

    pages.push({
      pageNumber: pageNum,
      dataUrl,
      base64,
      mimeType: 'image/png',
    });
  }

  return pages;
}

/**
 * Загружает картинку (скриншот табулатуры) в формат base64 для отправки на AI-распознавание
 */
export async function readImageFileAsPage(file: File): Promise<RenderedPdfPage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const base64 = dataUrl.split(',')[1] || '';
      resolve({
        pageNumber: 1,
        dataUrl,
        base64,
        mimeType: file.type || 'image/png',
      });
    };
    reader.onerror = () => reject(new Error('Не удалось прочитать файл изображения.'));
    reader.readAsDataURL(file);
  });
}

const VALID_TECHNIQUES: NoteTechnique[] = [
  'normal',
  'hammer',
  'slide',
  'harmonic',
  'slap',
  'ghost',
];

/**
 * Отправляет изображения страниц табулатуры на серверный маршрут /api/parse-tab-image
 * и нормализует ответ в нашу модель SongScore
 */
export async function parseTabImagesWithAI(
  pages: RenderedPdfPage[],
  titleHint: string
): Promise<SongScore> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error(
      'Нет подключения к интернету. Для оффлайн-работы загрузите файл Guitar Pro (.gp5/.gpx) или вставьте текстовый ASCII-таб.'
    );
  }

  const response = await fetch('/api/parse-tab-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      titleHint,
      images: pages.map((p) => ({
        mimeType: p.mimeType,
        data: p.base64,
      })),
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.score) {
    throw new Error(
      payload?.message ||
        'AI-распознавание недоступно. Для оффлайн-работы используйте файлы Guitar Pro (.gp5/.gpx) или ASCII-табы.'
    );
  }

  const raw = payload.score as {
    title?: string;
    artist?: string;
    bpm?: number;
    capo?: number;
    tuningName?: string;
    openStringMidi?: number[];
    measures?: Array<{
      index?: number;
      marker?: string;
      capoChange?: number;
      tempoOverride?: number;
      beats?: Array<{
        duration?: number;
        isRest?: boolean;
        notes?: Array<{
          string?: number;
          fret?: number;
          technique?: string;
        }>;
      }>;
    }>;
  };

  const openStringMidi =
    Array.isArray(raw.openStringMidi) && raw.openStringMidi.length === 6
      ? raw.openStringMidi.map((n) => Math.round(Number(n) || 40))
      : [...STANDARD_OPEN_MIDI];

  const measures: TabMeasure[] = (raw.measures || [])
    .map((m, mIdx) => {
      const beats: TabBeat[] = (m.beats || []).map((b, bIdx) => {
        const notes: TabNote[] = (b.notes || [])
          .filter((n) => typeof n.string === 'number' && n.string >= 1 && n.string <= 6)
          .map((n) => {
            const tech = VALID_TECHNIQUES.includes(n.technique as NoteTechnique)
              ? (n.technique as NoteTechnique)
              : 'normal';
            return {
              string: Math.max(1, Math.min(6, Math.round(n.string || 1))),
              fret: tech === 'slap' ? -1 : Math.max(0, Math.min(24, Math.round(n.fret ?? 0))),
              technique: tech,
            };
          });

        return {
          id: `ai-m${mIdx + 1}-b${bIdx + 1}`,
          duration:
            typeof b.duration === 'number' && b.duration > 0 ? b.duration : 1,
          isRest: b.isRest || notes.length === 0,
          notes,
        };
      });

      const marker = m.marker?.trim() || undefined;
      const capoChange =
        typeof m.capoChange === 'number' && m.capoChange >= 0 && m.capoChange <= 12
          ? m.capoChange
          : parseCapoFromMarker(marker);

      return {
        index: m.index || mIdx + 1,
        timeSignature: { beats: 4, value: 4 },
        marker,
        capoChange,
        tempoOverride:
          typeof m.tempoOverride === 'number' && m.tempoOverride >= 30
            ? Math.round(m.tempoOverride)
            : undefined,
        beats,
      };
    })
    .filter((m) => m.beats.length > 0);

  if (measures.length === 0) {
    throw new Error(
      'На изображении не удалось распознать такты табулатуры. Попробуйте более четкое фото или формат .gp5/.gpx.'
    );
  }

  return {
    id: `song-ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: raw.title?.trim() || titleHint || 'Распознанный таб',
    artist: raw.artist?.trim() || 'AI Import',
    bpm: Math.max(30, Math.min(240, Math.round(raw.bpm || 100))),
    tuning: {
      name: raw.tuningName?.trim() || 'Standard',
      openStringMidi,
    },
    capo: Math.max(0, Math.min(12, Math.round(raw.capo || 0))),
    measures,
    source: 'ai-pdf',
    createdAt: Date.now(),
  };
}
