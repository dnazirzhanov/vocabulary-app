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
      <h1 className={styles.context}>{submission.question?.title ?? t.writing}</h1>

      {/* The verdict: one word first, the details in one quiet line, then the summary. */}
      {ev && (
        <section aria-labelledby="w-overall" className={styles.verdict}>
          <h2 id="w-overall" className={enough ? styles.eyebrow : styles.verdictHeading}>
            {enough ? t.writingScoreHeading : t.writingTooLittleHeading}
          </h2>
          {enough && ev.overall !== null && (
            <>
              <p className={styles.verdictWord}>{scoreLabel(ev.overall)}</p>
              <p className={styles.muted}>
                {t.writingScoreOutOf(ev.overall)}
                {ev.cefr_level ? ` · ${t.writingLevel(ev.cefr_level)}` : ''}
                {submission.time_spent_seconds !== null
                  ? ` · ${t.writingTimeSpent(clock(submission.time_spent_seconds))}`
                  : ''}
              </p>
            </>
          )}
          <p className={styles.text}>{ev.summary}</p>
        </section>
      )}

      {/* One sheet, five rows: each category with its own fixes, divided by hairlines, no boxes inside. */}
      {ev && enough && ev.criteria && (
        <div className={styles.sheet}>
          {CRITERIA.map((name) => {
            const criterion = ev.criteria![name];
            const mistakes = ev.corrections.filter((c) => MISTAKE_HOME[c.type] === name);
            const tips = name === 'vocabulary' ? ev.vocabulary : [];
            const checksMistakes = name === 'grammar' || name === 'mechanics';
            return (
              <section key={name} className={styles.criterion} aria-labelledby={`w-${name}`}>
                <header className={styles.criterionHead}>
                  <h2 id={`w-${name}`} className={styles.criterionTitle}>
                    {criterionLabel(name)}
                  </h2>
                  <span
                    className={styles.pips}
                    role="img"
                    aria-label={`${scoreLabel(criterion.score)}, ${t.writingScoreOutOf(criterion.score)}`}
                    title={scoreLabel(criterion.score)}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <i key={n} className={n <= criterion.score ? styles.pipOn : styles.pip} />
                    ))}
                  </span>
                </header>
                <p className={styles.comment}>{criterion.comment}</p>
                {(mistakes.length > 0 || tips.length > 0) && (
                  <ul className={styles.fixes}>
                    {mistakes.map((c, i) => (
                      <li key={`m${i}`}>
                        <p className={styles.fixLine}>
                          <del>{c.original}</del>
                          <span className={styles.arrow} aria-hidden="true">
                            →
                          </span>
                          <ins>{c.corrected}</ins>
                        </p>
                        <p className={styles.fixWhy}>{c.explanation}</p>
                      </li>
                    ))}
                    {tips.map((v, i) => (
                      <li key={`v${i}`}>
                        <p className={styles.fixLine}>
                          {v.original}
                          <span className={styles.arrow} aria-hidden="true">
                            →
                          </span>
                          <ins>{v.suggestion}</ins>
                        </p>
                        {v.note && <p className={styles.fixWhy}>{v.note}</p>}
                      </li>
                    ))}
                  </ul>
                )}
                {checksMistakes && mistakes.length === 0 && <p className={styles.clean}>{t.writingNoMistakes}</p>}
              </section>
            );
          })}
        </div>
      )}

      {ev && ev.improvements.length > 0 && (
        <section className={styles.next} aria-labelledby="w-next">
          <h2 id="w-next" className={styles.nextTitle}>
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
