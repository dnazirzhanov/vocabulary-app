import type { StoneState } from '../lib/path.ts';
import styles from './PathView.module.css';

/** A stepping stone seen from slightly above. State shows in fill, mark and text, never colour alone. */
export function StoneMark({ state, number }: { state: StoneState; number: number }) {
  return (
    <svg viewBox="0 0 120 76" className={styles.stoneSvg} data-state={state} aria-hidden="true">
      <ellipse className={styles.ripple} cx="60" cy="58" rx="58" ry="14" />
      <ellipse className={styles.stoneSide} cx="60" cy="44" rx="52" ry="24" />
      <ellipse className={styles.stoneTop} cx="60" cy="36" rx="50" ry="21" />
      {state === 'firm' && (
        <g className={styles.moss}>
          <path d="M18 44q4-7 9-1" />
          <path d="M92 47q5-8 10-1" />
          <path d="M70 55q4-6 8 0" />
        </g>
      )}
      {state === 'done' || state === 'firm' ? (
        <path className={styles.check} d="M47 36l9 9 18-18" />
      ) : (
        <text className={styles.stoneNumber} x="60" y="36" dy="0.36em" textAnchor="middle">
          {number}
        </text>
      )}
    </svg>
  );
}
