import type { Counts } from '../lib/today.ts';
import styles from './CardCounts.module.css';
import { t } from '../i18n/index.ts';

const KINDS = [
  { key: 'fresh', label: t.newCardsLabel, className: styles.fresh },
  { key: 'learning', label: t.learningCards, className: styles.learning },
  { key: 'review', label: t.toReviewNow, className: styles.review },
] as const;

/** Anki's three numbers, each in its colour and always with its name; a zero steps back in grey. */
export function CardCounts({ counts }: { counts: Counts }) {
  return (
    <dl className={styles.counts}>
      {KINDS.map(({ key, label, className }) => (
        <div key={key} className={styles.count} data-zero={counts[key] === 0 || undefined}>
          <dt className={styles.label}>{label}</dt>
          <dd className={`${styles.value} ${className}`}>{counts[key]}</dd>
        </div>
      ))}
    </dl>
  );
}
