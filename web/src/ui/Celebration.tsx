import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { playCelebration } from '../lib/sounds.ts';
import styles from './Celebration.module.css';

const PIECES = 36;
const COLORS = [
  'var(--illo-accent)',
  'var(--illo-light)',
  'var(--illo-sky)',
  'var(--illo-peach)',
  'var(--color-primary)',
];
const SHAPES = ['strip', 'dot', 'square'] as const;
/** Long enough for the slowest piece to fall out of view. */
const LIFETIME_MS = 4200;

/** A small, fixed pseudo-random sequence, so the burst looks the same in tests and screenshots. */
function seeded(seed: number) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

/**
 * The moment something is finished (ADR 0024): a burst of confetti that falls past the screen and
 * a short chord. For any finish screen — a lesson, spelling, and rewards to come. Decoration only:
 * hidden from screen readers, never in the way of a tap, gone after a few seconds; with reduced
 * motion the confetti stays away and only the sound plays.
 */
export function Celebration() {
  const [shown, setShown] = useState(true);
  // Once per finish, even when React mounts the screen twice in development.
  const played = useRef(false);
  useEffect(() => {
    if (!played.current) playCelebration();
    played.current = true;
    const timer = window.setTimeout(() => setShown(false), LIFETIME_MS);
    return () => window.clearTimeout(timer);
  }, []);
  const pieces = useMemo(() => {
    const random = seeded(24);
    return Array.from({ length: PIECES }, (_, index) => ({
      shape: SHAPES[index % SHAPES.length],
      style: {
        '--x': `${Math.round(random() * 100)}vw`,
        '--drift': `${Math.round((random() - 0.5) * 30)}vw`,
        '--spin': `${Math.round(360 + random() * 720) * (random() < 0.5 ? -1 : 1)}deg`,
        '--delay': `${Math.round(random() * 600)}ms`,
        '--duration': `${Math.round(2200 + random() * 1600)}ms`,
        '--color': COLORS[index % COLORS.length],
      } as CSSProperties,
    }));
  }, []);
  if (!shown) return null;
  return (
    <div className={styles.layer} aria-hidden="true" data-celebration>
      {pieces.map((piece, index) => (
        <i key={index} className={styles.piece} data-shape={piece.shape} style={piece.style} />
      ))}
    </div>
  );
}
