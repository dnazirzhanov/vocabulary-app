import type { SpellingState } from '../lib/types.ts';
import { ForwardIcon, PencilIcon } from '../ui/icons.tsx';
import styles from './PausedSpelling.module.css';
import { t } from '../i18n/index.ts';

/**
 * A spelling session left unfinished (ADR 0026): how far it got, and a way back to the next
 * word. Shown on every deck's page until it is done or another set of words is chosen (ADR 0050).
 */
export function PausedSpelling({
  paused,
  disabled,
  onResume,
}: {
  paused: NonNullable<SpellingState['paused']>;
  disabled?: boolean;
  onResume: () => void;
}) {
  const { spelled, right, total } = paused;
  const left = total - spelled;
  const missed = spelled - right;
  return (
    <button
      type="button"
      className={styles.card}
      disabled={disabled}
      onClick={onResume}
      aria-label={t.continueSpelling}
      aria-describedby="paused-spelling-note"
    >
      <PencilIcon className={styles.icon} aria-hidden="true" />
      <span className={styles.text}>
        <strong>{t.spellingNotFinished}</strong>
        <span id="paused-spelling-note" className={styles.note}>
          {t.pausedProgress(spelled, total, right, missed, left)}
        </span>
        <span
          className={styles.bar}
          role="progressbar"
          aria-label={t.wordsWritten}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={spelled}
        >
          <span data-tone="right" style={{ width: `${(right / total) * 100}%` }} />
          <span data-tone="missed" style={{ width: `${(missed / total) * 100}%` }} />
        </span>
      </span>
      <span className={styles.resume}>
        {t.continue} <ForwardIcon aria-hidden="true" />
      </span>
    </button>
  );
}
