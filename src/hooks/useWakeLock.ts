import { useCallback, useEffect, useRef, useState } from 'react';

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: string, listener: () => void) => void;
}

/**
 * Хук управления Screen Wake Lock API.
 * Удерживает экран смартфона включенным, пока активно прослушивание тюнера или работает метроном.
 */
export function useWakeLock(shouldKeepAwake: boolean) {
  const [isSupported, setIsSupported] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    setIsSupported(
      typeof navigator !== 'undefined' &&
        'wakeLock' in navigator &&
        typeof (navigator as unknown as { wakeLock?: { request?: unknown } }).wakeLock?.request ===
          'function'
    );
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    try {
      if (sentinelRef.current && !sentinelRef.current.released) return;
      const wakeLockApi = (
        navigator as unknown as {
          wakeLock: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
        }
      ).wakeLock;
      const sentinel = await wakeLockApi.request('screen');
      sentinelRef.current = sentinel;
      setIsLocked(true);
      sentinel.addEventListener('release', () => {
        setIsLocked(false);
      });
    } catch {
      setIsLocked(false);
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    if (sentinelRef.current) {
      try {
        await sentinelRef.current.release();
      } catch {
        // ignore
      }
      sentinelRef.current = null;
      setIsLocked(false);
    }
  }, []);

  useEffect(() => {
    if (shouldKeepAwake) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }
  }, [shouldKeepAwake, requestWakeLock, releaseWakeLock]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && shouldKeepAwake) {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [shouldKeepAwake, requestWakeLock]);

  useEffect(() => {
    return () => {
      releaseWakeLock();
    };
  }, [releaseWakeLock]);

  return { isSupported, isLocked };
}
