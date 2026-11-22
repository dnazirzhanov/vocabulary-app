/**
 * A compact player for one recording: play/pause, a seek bar and the time. Only one sound plays
 * at a time across the shadowing screens (oneAtATime), and the length never reads 0:00 or ∞ for
 * a fresh recording: the length we already know is used when the file reports none.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { t } from '../i18n/index.ts';
import { claimPlayback, clock, mediaDuration, releasePlayback } from './oneAtATime.ts';
import styles from './AudioPlayer.module.css';

export interface AudioPlayerProps {
  src: string;
  label: string;
  /** The length when known (exercise or recording); used when the file reports none. */
  knownDurationMs?: number;
  /** Start playing at once: the tap that asked for it already happened. */
  autoPlay?: boolean;
  disabled?: boolean;
}

export function AudioPlayer({ src, label, knownDurationMs, autoPlay = false, disabled = false }: AudioPlayerProps) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);
  const [length, setLength] = useState(() => (knownDurationMs ?? 0) / 1000);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => setLength(mediaDuration(el, knownDurationMs));
    const onPlay = () => {
      claimPlayback(el);
      setPlaying(true);
    };
    const onPause = () => setPlaying(false);
    const onTime = () => setNow(el.currentTime);
    const onEnded = () => {
      setPlaying(false);
      setNow(0);
      el.currentTime = 0;
    };
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', sync);
    el.addEventListener('durationchange', sync);
    el.addEventListener('ended', onEnded);
    if (autoPlay) el.play().catch(() => setPlaying(false));
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', sync);
      el.removeEventListener('durationchange', sync);
      el.removeEventListener('ended', onEnded);
      el.pause();
      releasePlayback(el);
    };
    // A new source is a new player; autoPlay and the known length are read when it mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => setPlaying(false));
    else el.pause();
  };

  const seek = (value: number) => {
    const el = ref.current;
    if (!el) return;
    el.currentTime = value;
    setNow(value);
  };

  const shown = length ? Math.min(now, length) : now;
  return (
    <div className={styles.player}>
      <audio ref={ref} src={src} preload="metadata" />
      <button
        type="button"
        className={styles.play}
        onClick={toggle}
        disabled={disabled}
        aria-label={playing ? t.shadowingPause : t.shadowingPlay}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className={styles.body}>
        <span className={styles.label}>{label}</span>
        <input
          type="range"
          className={styles.seek}
          min={0}
          max={length || 1}
          step={0.1}
          value={shown}
          onChange={(e) => seek(Number(e.target.value))}
          disabled={disabled || length === 0}
          aria-label={label}
          style={{ '--progress': `${length ? (shown / length) * 100 : 0}%` } as CSSProperties}
        />
      </div>
      <span className={styles.time}>
        {clock(shown)} / {clock(length)}
      </span>
    </div>
  );
}

export function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6.5" y="5" width="4" height="14" rx="1.2" />
      <rect x="13.5" y="5" width="4" height="14" rx="1.2" />
    </svg>
  );
}
