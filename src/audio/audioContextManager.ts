/**
 * Единый менеджер AudioContext для всего приложения (Тюнер, Табы, Метроном, Синтезатор).
 * Гарантирует отсутствие конфликтов аудиопотоков на iOS Safari и Android Chrome.
 */

let sharedAudioContext: AudioContext | null = null;

export function getSharedAudioContext(): AudioContext {
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedAudioContext = new AudioCtx();
  }
  return sharedAudioContext;
}

export async function ensureAudioContextResumed(): Promise<AudioContext> {
  const ctx = getSharedAudioContext();
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }
  return ctx;
}
