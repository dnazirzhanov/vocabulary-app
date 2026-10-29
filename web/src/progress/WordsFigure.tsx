import { plural } from '../i18n/plural.ts';
import type { Progress } from '../lib/types.ts';
import styles from './Progress.module.css';

const thousands = (n: number) => n.toLocaleString('ru-RU');

/**
 * How far along the course the learner is, in one figure: words met out of the course goal,
 * with those remembered well shown darker inside it, and two small figures beside it.
 */
export function WordsFigure({ progress, goalWords }: { progress: Progress; goalWords: number }) {
  const { words, recall } = progress;
  const goal = Math.max(goalWords, words.introduced);
  const recallPercent = recall.reviewed ? Math.round((recall.recalled / recall.reviewed) * 100) : null;
  return (
    <section aria-labelledby="words-heading">
      <h2 id="words-heading" className={styles.sectionTitle}>
        Слова
      </h2>
      <p className={styles.hero}>
        <strong>{thousands(words.introduced)}</strong>{' '}
        <span>
          из {thousands(goal)} {plural(goal, { one: 'слова', few: 'слов', many: 'слов' })}
        </span>
      </p>
      <div
        className={styles.bar}
        role="meter"
        aria-label="Слов изучено"
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-valuenow={words.introduced}
      >
        <span className={styles.barMet} style={{ width: `${(words.introduced / goal) * 100}%` }} />
        <span className={styles.barKnown} style={{ width: `${(words.well_learned / goal) * 100}%` }} />
      </div>
      <dl className={styles.figures}>
        <div>
          <dt>
            <i className={styles.dotKnown} aria-hidden="true" />
            Помните хорошо
          </dt>
          <dd>{words.well_learned}</dd>
        </div>
        <div>
          <dt>
            <i className={styles.dotMet} aria-hidden="true" />
            Ещё закрепляете
          </dt>
          <dd>{words.reviewing}</dd>
        </div>
        <div>
          <dt>Память за {recall.days} дн.</dt>
          <dd>{recallPercent === null ? '—' : `${recallPercent}%`}</dd>
        </div>
      </dl>
    </section>
  );
}
