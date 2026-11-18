import { t } from '../i18n/index.ts';
import { CRITERIA, type Submission } from './api.ts';
import { clock } from './stopwatch.ts';
import { criterionLabel, scoreLabel } from './scoreText.ts';
import styles from './Writing.module.css';

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
        <section aria-labelledby="w-overall">
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
          {enough && ev.criteria && (
            <dl className={styles.criteria}>
              {CRITERIA.map((name) => (
                <div key={name} className={styles.criterion}>
                  <dt>
                    {criterionLabel(name)}{' '}
                    <span className={styles.muted}>· {scoreLabel(ev.criteria![name].score)}</span>
                  </dt>
                  <dd>{ev.criteria![name].comment}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      )}

      {ev && enough && ev.strengths.length > 0 && (
        <section aria-labelledby="w-well">
          <h2 id="w-well" className={styles.sectionTitle}>
            {t.writingDidWell}
          </h2>
          <ul className={styles.bullets}>
            {ev.strengths.map((s, i) => (
              <li key={i}>
                {s.point}
                {s.quote && <q className={styles.quote}>{s.quote}</q>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {ev && ev.improvements.length > 0 && (
        <section aria-labelledby="w-improve">
          <h2 id="w-improve" className={styles.sectionTitle}>
            {enough ? t.writingImprove : t.writingNextStep}
          </h2>
          <ul className={styles.bullets}>
            {ev.improvements.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </section>
      )}

      {ev && enough && (
        <section aria-labelledby="w-mistakes">
          <h2 id="w-mistakes" className={styles.sectionTitle}>
            {t.writingMistakes}
          </h2>
          {ev.corrections.length === 0 ? (
            <p className={styles.text}>{t.writingNoMistakes}</p>
          ) : (
            <ul className={styles.fixes}>
              {ev.corrections.map((c, i) => (
                <li key={i} className={styles.fix}>
                  <p className={styles.fixLine}>
                    <del>{c.original}</del> → <ins>{c.corrected}</ins>
                  </p>
                  <p className={styles.fixWhy}>{c.explanation}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {ev && enough && ev.vocabulary.length > 0 && (
        <section aria-labelledby="w-vocab">
          <h2 id="w-vocab" className={styles.sectionTitle}>
            {t.writingVocabulary}
          </h2>
          <ul className={styles.fixes}>
            {ev.vocabulary.map((v, i) => (
              <li key={i} className={styles.fix}>
                <p className={styles.fixLine}>
                  {v.original} → <strong>{v.suggestion}</strong>
                </p>
                {v.note && <p className={styles.fixWhy}>{v.note}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {ev && enough && ev.improved_version && (
        <section aria-labelledby="w-improved">
          <h2 id="w-improved" className={styles.sectionTitle}>
            {t.writingImproved}
          </h2>
          <p className={`${styles.text} ${styles.essay}`}>{ev.improved_version}</p>
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
