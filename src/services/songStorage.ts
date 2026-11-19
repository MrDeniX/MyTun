import { SongScore } from '../types/tabs';
import { BUILTIN_DEMO_SONG } from './demoSong';

const DB_NAME = 'tone01_tabs_db';
const DB_VERSION = 1;
const STORE_NAME = 'songs';
const FALLBACK_LS_KEY = 'tone01_songs_fallback_v1';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB'));
  });
}

function readFallbackSongs(): SongScore[] {
  try {
    const raw = localStorage.getItem(FALLBACK_LS_KEY);
    if (!raw) return [BUILTIN_DEMO_SONG];
    const parsed = JSON.parse(raw) as SongScore[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [BUILTIN_DEMO_SONG];
    const hasDemo = parsed.some((s) => s.id === BUILTIN_DEMO_SONG.id);
    return hasDemo ? parsed : [BUILTIN_DEMO_SONG, ...parsed];
  } catch {
    return [BUILTIN_DEMO_SONG];
  }
}

function writeFallbackSongs(songs: SongScore[]): void {
  try {
    localStorage.setItem(FALLBACK_LS_KEY, JSON.stringify(songs));
  } catch {
    // ignore quota errors
  }
}

export async function getAllSongs(): Promise<SongScore[]> {
  try {
    const db = await openDatabase();
    const songs = await new Promise<SongScore[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as SongScore[]) || []);
      req.onerror = () => reject(req.error);
    });

    const hasDemo = songs.some((s) => s.id === BUILTIN_DEMO_SONG.id);
    if (!hasDemo) {
      await saveSong(BUILTIN_DEMO_SONG);
      songs.unshift(BUILTIN_DEMO_SONG);
    }

    return songs.sort((a, b) => {
      if (a.isDemo && !b.isDemo) return 1;
      if (!a.isDemo && b.isDemo) return -1;
      return b.createdAt - a.createdAt;
    });
  } catch {
    return readFallbackSongs();
  }
}

export async function saveSong(song: SongScore): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(song);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    const existing = readFallbackSongs().filter((s) => s.id !== song.id);
    writeFallbackSongs([song, ...existing]);
  }
}

export async function deleteSong(songId: string): Promise<void> {
  if (songId === BUILTIN_DEMO_SONG.id) return;
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(songId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    const remaining = readFallbackSongs().filter((s) => s.id !== songId);
    writeFallbackSongs(remaining);
  }
}

export async function updateSongBestAccuracy(
  songId: string,
  accuracy: number
): Promise<SongScore | null> {
  const all = await getAllSongs();
  const target = all.find((s) => s.id === songId);
  if (!target) return null;

  const rounded = Math.round(Math.max(0, Math.min(100, accuracy)));
  if (typeof target.bestAccuracy === 'number' && target.bestAccuracy >= rounded) {
    return target;
  }

  const updated: SongScore = {
    ...target,
    bestAccuracy: rounded,
  };
  await saveSong(updated);
  return updated;
}
