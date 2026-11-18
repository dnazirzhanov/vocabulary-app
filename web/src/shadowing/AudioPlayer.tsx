/**
 * Reusable audio player for the shadowing feature.
 * Wraps a hidden <audio> element with custom play/pause, seek bar, speed buttons,
 * and time display. Used in both ShadowingPlayerScreen and ShadowingCompareScreen.
 */
import { useEffect, useRef, useState } from 'react';
import styles from './AudioPlayer.module.css';

export interface AudioPlayerProps {
  src: string;
  label: string;
  speeds?: number[];
  showSpeed?: boolean;
  /** Called when audio ends naturally */
  onEnded?: () => void;
  /** If true, play button is disabled (audio not available) */
  disabled?: boolean;
}

function formatTime(sec: number): string {
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function AudioPlayer({
  src,
  label,
  speeds = [0.75, 1.0, 1.25],
  showSpeed = true,
  onEnded,
  disabled = false,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1.0);

  // Sync speed to audio element
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.playbackRate = speed;
  }, [speed]);

  // Wire audio events
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () => setCurrentTime(el.currentTime);
    const onLoadedMetadata = () => setDuration(el.duration);
    const onEndedHandler = () => {
      setPlaying(false);
      onEnded?.();
    };

    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('loadedmetadata', onLoadedMetadata);
    el.addEventListener('ended', onEndedHandler);

    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('loadedmetadata', onLoadedMetadata);
      el.removeEventListener('ended', onEndedHandler);
    };
  }, [onEnded]);

  // Reset when src changes
  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
    } else {
      el.play().catch(() => {});
    }
  };

  const onSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = audioRef.current;
    if (!el) return;
    const val = Number(e.target.value);
    el.currentTime = val;
    setCurrentTime(val);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className={styles.player}>
      <span className={styles.label}>{label}</span>

      {/* Hidden audio element */}
      <audio ref={audioRef} src={src} preload="metadata" />

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.playBtn}
          onClick={togglePlay}
          disabled={disabled}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? '⏸' : '▶'}
        </button>

        <div className={styles.seekArea}>
          <input
            type="range"
            className={styles.seek}
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={onSeek}
            disabled={disabled || duration === 0}
            style={{ '--progress': `${progress}%` } as React.CSSProperties}
          />
          <div className={styles.times}>
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      </div>

      {showSpeed && (
        <div className={styles.speeds}>
          {speeds.map((s) => (
            <button
              key={s}
              type="button"
              className={`${styles.speedBtn} ${speed === s ? styles.speedActive : ''}`}
              onClick={() => setSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
