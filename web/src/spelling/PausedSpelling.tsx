import { plural } from '../i18n/plural.ts';
import type { SpellingState } from '../lib/types.ts';
import { ForwardIcon, PencilIcon } from '../ui/icons.tsx';
import styles from './PausedSpelling.module.css';

/**
 * A spelling session left unfinished (ADR 0026): how far it got, and a way back to the next
 * word. Shown on home and on every deck's page until it is done, so it is never lost.
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
      aria-label="Продолжить правописание"
      aria-describedby="paused-spelling-note"
    >
      <PencilIcon className={styles.icon} aria-hidden="true" />
      <span className={styles.text}>
        <strong>Правописание не закончено</strong>
        <span id="paused-spelling-note" className={styles.note}>
          Написано {spelled} из {total}
          {spelled > 0 && ` (верно ${right}${missed ? `, с ошибкой ${missed}` : ''})`} · осталось {left}{' '}
          {plural(left, { one: 'слово', few: 'слова', many: 'слов' })}
        </span>
        <span
          className={styles.bar}
          role="progressbar"
          aria-label="Написано слов"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={spelled}
        >
          <span data-tone="right" style={{ width: `${(right / total) * 100}%` }} />
          <span data-tone="missed" style={{ width: `${(missed / total) * 100}%` }} />
        </span>
      </span>
      <span className={styles.resume}>
        Продолжить <ForwardIcon aria-hidden="true" />
      </span>
    </button>
  );
}
