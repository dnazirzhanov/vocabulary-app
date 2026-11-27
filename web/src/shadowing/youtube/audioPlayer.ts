import { EARLY_MS, type VideoPlayer } from './player.ts';

const POLL_MS = 20;

/** Our own audio (a curated exercise) behind the same controls as YouTube's player. */
export function audioPlayer(el: HTMLAudioElement): VideoPlayer {
  let timer: ReturnType<typeof setInterval> | null = null;
  let finish: ((how: 'ended' | 'stopped') => void) | null = null;
  const stopWatching = (how: 'ended' | 'stopped') => {
    if (timer) clearInterval(timer);
    timer = null;
    const done = finish;
    finish = null;
    done?.(how);
  };
  return {
    playSegment(startMs, endMs, rate = 1) {
      stopWatching('stopped');
      el.playbackRate = rate;
      el.currentTime = startMs / 1000;
      return new Promise((resolve) => {
        finish = resolve;
        el.play().catch(() => stopWatching('stopped'));
        timer = setInterval(() => {
          if (el.currentTime * 1000 >= endMs - EARLY_MS || el.ended) {
            el.pause();
            stopWatching('ended');
          }
        }, POLL_MS);
      });
    },
    setRate(rate) {
      el.playbackRate = rate;
    },
    play(fromMs, rate = 1) {
      stopWatching('stopped');
      el.playbackRate = rate;
      if (fromMs !== undefined) el.currentTime = fromMs / 1000;
      void el.play().catch(() => undefined);
    },
    pause() {
      stopWatching('stopped');
      el.pause();
    },
    now() {
      return Math.round(el.currentTime * 1000);
    },
    destroy() {
      stopWatching('stopped');
      el.pause();
    },
  };
}
