/**
 * YouTube's own player, driven by our buttons (ADR 0097). YouTube's terms allow only its visible
 * player: the video is shown, never hidden or downloaded. We seek, play, pause and read the time.
 *
 * `playSegment` plays one sentence and pauses at its end. It waits for real playback (an ad or
 * buffering may come first), so a sentence is never cut short.
 */

/** The part of YouTube's IFrame API we use. */
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setPlaybackRate(rate: number): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      host?: string;
      width?: string | number;
      height?: string | number;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (event: { data: number }) => void;
        onError?: (event: { data: number }) => void;
      };
    },
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const API = 'https://www.youtube.com/iframe_api';
const PLAYING = 1;
const POLL_MS = 50;

let loading: Promise<YTNamespace> | null = null;

/** YouTube's script, once per page. */
function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loading) return loading;
  loading = new Promise<YTNamespace>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = API;
    script.async = true;
    script.onerror = () => {
      loading = null;
      reject(new Error('youtube_unreachable'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** Why the video can't play: gone or private, not allowed here, or YouTube can't be reached. */
export type VideoProblem = 'unavailable' | 'not_embeddable' | 'unreachable';

export interface VideoPlayer {
  /** Plays [start, end) at `rate`, then pauses; 'stopped' if something else took over first. */
  playSegment(startMs: number, endMs: number, rate?: number): Promise<'ended' | 'stopped'>;
  /** Plays on from `fromMs` (or where it is) until paused. */
  play(fromMs?: number, rate?: number): void;
  pause(): void;
  /** Where the video is, in ms. */
  now(): number;
  destroy(): void;
}

export interface PlayerEvents {
  onReady?: () => void;
  onPlayingChange?: (playing: boolean) => void;
  onProblem?: (problem: VideoProblem) => void;
}

/** YouTube's error codes (2, 5, 100, 101, 150, 153) as what the learner is told. */
function problemOf(code: number): VideoProblem {
  if (code === 101 || code === 150 || code === 153) return 'not_embeddable';
  return 'unavailable';
}

export function createPlayer(element: HTMLElement, videoId: string, events: PlayerEvents = {}): VideoPlayer {
  let player: YTPlayer | null = null;
  let ready = false;
  let destroyed = false;
  // Each playSegment gets a turn; a newer one (or pause) ends the older one's wait.
  let turn = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let finishTurn: ((how: 'ended' | 'stopped') => void) | null = null;

  const stopWatching = (how: 'ended' | 'stopped') => {
    if (timer) clearInterval(timer);
    timer = null;
    const finish = finishTurn;
    finishTurn = null;
    finish?.(how);
  };

  loadApi().then(
    (YT) => {
      if (destroyed) return;
      player = new YT.Player(element, {
        videoId,
        host: 'https://www.youtube-nocookie.com',
        width: '100%',
        height: '100%',
        playerVars: {
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          iv_load_policy: 3,
          origin: window.location.origin,
          widget_referrer: window.location.href,
        },
        events: {
          onReady: () => {
            ready = true;
            events.onReady?.();
          },
          onStateChange: (event) => events.onPlayingChange?.(event.data === PLAYING),
          onError: (event) => events.onProblem?.(problemOf(event.data)),
        },
      });
    },
    () => events.onProblem?.('unreachable'),
  );

  const seek = (ms: number) => player?.seekTo(ms / 1000, true);

  return {
    playSegment(startMs, endMs, rate = 1) {
      stopWatching('stopped');
      if (!player || !ready) return Promise.resolve('stopped');
      const mine = ++turn;
      const p = player;
      p.setPlaybackRate(rate);
      seek(startMs);
      p.playVideo();
      return new Promise((resolve) => {
        finishTurn = resolve;
        timer = setInterval(() => {
          if (mine !== turn) return;
          // Only real playback counts: an ad or buffering first doesn't end the sentence.
          if (p.getPlayerState() !== PLAYING) return;
          if (p.getCurrentTime() * 1000 >= endMs) {
            p.pauseVideo();
            stopWatching('ended');
          }
        }, POLL_MS);
      });
    },
    play(fromMs, rate = 1) {
      stopWatching('stopped');
      if (!player || !ready) return;
      player.setPlaybackRate(rate);
      if (fromMs !== undefined) seek(fromMs);
      player.playVideo();
    },
    pause() {
      turn += 1;
      stopWatching('stopped');
      player?.pauseVideo();
    },
    now() {
      return player && ready ? Math.round(player.getCurrentTime() * 1000) : 0;
    },
    destroy() {
      destroyed = true;
      stopWatching('stopped');
      player?.destroy();
      player = null;
    },
  };
}
