import { deckStages } from '../lib/deckStages.ts';
import styles from './WordStages.module.css';

const width = (part: number, whole: number) => `${whole ? Math.min(100, (part / whole) * 100) : 0}%`;

/** «met / total», beside a card's title. */
export function WordCount({ met, total }: { met: number; total: number }) {
  return (
    <span className={styles.count}>
      {met}&nbsp;/&nbsp;{total}
    </span>
  );
}

/**
 * Words in a deck, the same wherever they appear (ADR 0034, 0052): two tones, words I know (strong)
 * inside words met (light), and the line below naming them.
 */
export function WordStages({ met, learned, total }: { met: number; learned: number; total: number }) {
  const stages = deckStages({ word_count: total, met, learned });
  return (
    <span className={styles.block}>
      <span className={styles.bar} role="img" aria-label={stages}>
        <span data-tone="met" style={{ width: width(met, total) }} />
        <span data-tone="learned" style={{ width: width(learned, total) }} />
      </span>
      <span className={styles.stages}>{stages}</span>
    </span>
  );
}
