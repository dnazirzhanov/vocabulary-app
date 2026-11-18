import { t } from '../i18n/index.ts';
import { CRITERIA, type CriterionName, type Mistake, type Submission } from './api.ts';
import { clock } from './stopwatch.ts';
import { criterionLabel, scoreLabel } from './scoreText.ts';
import styles from './Writing.module.css';

/** Which category a mistake belongs under. */
const MISTAKE_HOME: Record<Mistake['type'], CriterionName> = {
  grammar: 'grammar',
  spelling: 'mechanics',
  punctuation: 'mechanics',
  word_choice: 'vocabulary',
};

interface Props {
  submission: Submission;
  /** Back to the writing screen with this answer in the box; absent if the question is gone. */
  onWriteAgain?: () => void;
  onAnother: () => void;
}

export function ResultScreen({ submission, onWriteAgain, onAnother }: Props) {
  const ev = submission.evaluation;
  const enough = ev !== null && ev.enough_evidence && ev.criteria !== null && ev.overall !== null;
  return (
    <main className={styles.screen}>
      <h1 className={styles.question}>{submission.question?.title ?? t.writing}</h1>

      {ev && (
        <section aria-labelledby="w-overall" className={styles.overview}>
          <h2 id="w-overall" className={styles.sectionTitle}>
            {enough ? t.writingScoreHeading : t.writingTooLittleHeading}
          </h2>
          {enough && ev.overall !== null && (
            <p className={styles.bigScore}>
              <strong>{scoreLabel(ev.overall)}</strong>
              <span className={styles.muted}>
                {t.writingScoreOutOf(ev.overall)}
                {ev.cefr_level ? ` · ${t.writingLevel(ev.cefr_level)}` : ''}
                {submission.time_spent_seconds !== null
                  ? ` · ${t.writingTimeSpent(clock(submission.time_spent_seconds))}`
                  : ''}
              </span>
            </p>
          )}
          <p className={styles.text}>{ev.summary}</p>
        </section>
      )}

      {ev &&
        enough &&
        ev.criteria &&
        CRITERIA.map((name) => {
          const criterion = ev.criteria![name];
          const mistakes = ev.corrections.filter((c) => MISTAKE_HOME[c.type] === name);
          const tips = name === 'vocabulary' ? ev.vocabulary : [];
          const checksMistakes = name === 'grammar' || name === 'mechanics';
          return (
            <section key={name} className={styles.category} aria-labelledby={`w-${name}`}>
              <header className={styles.categoryHead}>
                <h2 id={`w-${name}`} className={styles.categoryTitle}>
                  {criterionLabel(name)}
                </h2>
                <span className={styles.meter}>
                  <span className={styles.meterBars} aria-hidden="true">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <i key={n} className={n <= criterion.score ? styles.barOn : styles.bar} />
                    ))}
                  </span>
                  <span className={styles.muted}>{scoreLabel(criterion.score)}</span>
                </span>
              </header>
              <p className={styles.comment}>{criterion.comment}</p>
              {(mistakes.length > 0 || tips.length > 0) && (
                <ul className={styles.fixes}>
                  {mistakes.map((c, i) => (
                    <li key={`m${i}`} className={styles.fix}>
                      <p className={styles.fixLine}>
                        <del>{c.original}</del> → <ins>{c.corrected}</ins>
                      </p>
                      <p className={styles.fixWhy}>{c.explanation}</p>
                    </li>
                  ))}
                  {tips.map((v, i) => (
                    <li key={`v${i}`} className={styles.fix}>
                      <p className={styles.fixLine}>
                        {v.original} → <ins>{v.suggestion}</ins>
                      </p>
                      {v.note && <p className={styles.fixWhy}>{v.note}</p>}
                    </li>
                  ))}
                </ul>
              )}
              {checksMistakes && mistakes.length === 0 && <p className={styles.muted}>{t.writingNoMistakes}</p>}
            </section>
          );
        })}

      {ev && ev.improvements.length > 0 && (
        <section className={styles.category} aria-labelledby="w-next">
          <h2 id="w-next" className={styles.categoryTitle}>
            {t.writingNextStep}
          </h2>
          <ol className={styles.steps}>
            {ev.improvements.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </section>
      )}

      <details className={styles.original}>
        <summary>{t.writingYourAnswer}</summary>
        <p className={`${styles.text} ${styles.essay}`}>{submission.answer}</p>
      </details>

      <div className={styles.actions}>
        {onWriteAgain && (
          <button type="button" className={styles.secondary} onClick={onWriteAgain}>
            {t.writingWriteAgain}
          </button>
        )}
        <button type="button" className={styles.submit} onClick={onAnother}>
          {t.writingTryAnother}
        </button>
      </div>
    </main>
  );
}
