import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { differences } from '../lib/spelling.ts';
import { scoreText } from '../lib/groupTests.ts';
import type { TestAttempt } from '../lib/types.ts';
import summary from '../summary/SessionSummary.module.css';
import { Celebration } from '../ui/Celebration.tsx';
import { RepeatIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { SecondaryButton } from '../ui/SecondaryButton.tsx';
import styles from './TestResult.module.css';

type Result = NonNullable<TestAttempt['result']>;
type Mistake = Result['mistakes'][number];

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** The score at a glance: how much of the ring is filled, and where the pass mark stood if it fell short. */
function ScoreRing({ result }: { result: Result }) {
  const share = result.total ? result.correct / result.total : 0;
  const style = { '--ring-empty': CIRCUMFERENCE * (1 - share) } as CSSProperties;
  return (
    <div className={styles.ring} role="img" aria-label={scoreText(result)}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className={styles.track} cx="60" cy="60" r={RADIUS} />
        <circle
          className={styles.fill}
          data-short={result.passed === false || undefined}
          cx="60"
          cy="60"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          style={style}
        />
        {result.passed === false && result.pass_percent !== null && (
          <line
            className={styles.passMark}
            x1="103"
            y1="60"
            x2="121"
            y2="60"
            transform={`rotate(${(result.pass_percent / 100) * 360} 60 60)`}
          />
        )}
      </svg>
      <span className={styles.score} aria-hidden="true">
        <strong>{result.correct}</strong>
        <small>из {result.total}</small>
      </span>
    </div>
  );
}

function titleOf(attempt: TestAttempt, result: Result): string {
  if (result.correct === result.total) return 'Без единой ошибки!';
  if (attempt.kind === 'practice') return 'Тренировка пройдена';
  return result.passed ? 'Тест сдан' : 'Пока не сдан';
}

function leadOf(attempt: TestAttempt, result: Result): string | null {
  const parts: string[] = [];
  if (result.timed_out) parts.push('Время вышло.');
  if (result.passed === false && result.pass_percent !== null) parts.push(`Нужно от ${result.pass_percent}%.`);
  // Only a test's misses go to «Трудные». The words the time ran out on say nothing about the
  // student, so they don't go (ADR 0048).
  const wrong = result.mistakes.some((mistake) => mistake.answer !== null);
  const skipped = result.mistakes.some((mistake) => mistake.skipped);
  const what =
    wrong && skipped ? 'Ошибки и пропуски' : wrong ? 'Слова с ошибками' : skipped ? 'Пропущенные слова' : null;
  if (what && attempt.kind === 'test') parts.push(`${what} ждут вас в «Трудных».`);
  return parts.length ? parts.join(' ') : null;
}

function Group(props: { title: string; words: Mistake[]; icon?: ReactNode }) {
  const { title, words, icon } = props;
  if (words.length === 0) return null;
  return (
    <section aria-label={title} className={summary.group}>
      <h2 className={summary.groupTitle}>
        {title} <span className={summary.groupCount}>{words.length}</span>
      </h2>
      <ul className={summary.words}>
        {words.map((mistake) => (
          <li key={mistake.word} className={summary.wordRow}>
            <span className={summary.thumb}>
              <span className={summary.initial} aria-hidden="true">
                {mistake.word.charAt(0)}
              </span>
            </span>
            <span className={summary.wordText}>
              <span className={summary.word} lang="en">
                {mistake.word}
              </span>
              <span className={summary.translation}>{mistake.translation}</span>
              {mistake.answer !== null && (
                <span className={styles.written}>
                  Вы написали:{' '}
                  <span lang="en">
                    {differences(mistake.answer, mistake.word).map(({ letter, differs }, index) =>
                      differs ? <mark key={index}>{letter}</mark> : <span key={index}>{letter}</span>,
                    )}
                  </span>
                </span>
              )}
            </span>
            {icon && (
              <span className={summary.status} data-status="missed" aria-hidden="true">
                {icon}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * How a test or a practice went, in the language of a lesson's finish (ADR 0024): the score on the stage
 * and a title beneath it, then what to go over, with the way on always in the same place at the bottom.
 */
export function TestResult(props: {
  attempt: TestAttempt;
  result: Result;
  busy: boolean;
  error: string | null;
  onAgain: () => void;
  onDone: () => void;
}) {
  const { attempt, result, busy, error, onAgain, onDone } = props;
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const wrong = result.mistakes.filter((mistake) => mistake.answer !== null);
  const skipped = result.mistakes.filter((mistake) => mistake.skipped);
  const missed = result.mistakes.filter((mistake) => mistake.answer === null && !mistake.skipped);
  const lead = leadOf(attempt, result);
  // A moment worth marking: a pass, or a practice without a mistake.
  const celebrate = result.passed === true || result.mistakes.length === 0;
  return (
    <div className={summary.screen}>
      {celebrate && <Celebration />}
      <main className={summary.main}>
        <div className={summary.layout}>
          <div className={summary.stage}>
            <ScoreRing result={result} />
          </div>
          <div className={summary.intro}>
            <h1 ref={headingRef} tabIndex={-1} className={summary.title}>
              {titleOf(attempt, result)}
            </h1>
            {lead && <p className={summary.lead}>{lead}</p>}
          </div>
          {result.mistakes.length > 0 && (
            <div className={summary.recap}>
              <Group title="Ошибки" words={wrong} icon={<RepeatIcon />} />
              <Group title="Пропущено" words={skipped} icon={<RepeatIcon />} />
              <Group title="Не успели" words={missed} />
            </div>
          )}
        </div>
      </main>
      <footer className={summary.actions}>
        {error && (
          <p className={summary.error} role="alert">
            {error}
          </p>
        )}
        <div className={summary.actionsInner}>
          {attempt.kind === 'practice' && (
            <SecondaryButton
              type="button"
              className={`${summary.action} ${summary.secondary}`}
              disabled={busy}
              onClick={onAgain}
            >
              Ещё раз
            </SecondaryButton>
          )}
          <PrimaryButton type="button" className={summary.action} onClick={onDone}>
            Готово
          </PrimaryButton>
        </div>
      </footer>
    </div>
  );
}
