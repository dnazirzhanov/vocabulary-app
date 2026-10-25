import { useEffect, useRef } from 'react';
import { plural } from '../i18n/plural.ts';
import { Illustration } from '../illustrations/index.tsx';
import type { AnswerResult } from '../lesson/lessonSession.ts';
import { summarizeSession, type WordOutcome } from '../lesson/sessionSummary.ts';
import type { ChoiceExercise } from '../lesson/types.ts';
import { CheckIcon, RepeatIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { SecondaryButton } from '../ui/SecondaryButton.tsx';
import { CompletionBadge } from './CompletionBadge.tsx';
import styles from './SessionSummary.module.css';

export type SessionKind = 'lesson' | 'mistakes';

interface SessionSummaryProps {
  kind: SessionKind;
  exercises: readonly ChoiceExercise[];
  results: readonly AnswerResult[];
  onPracticeMistakes: (exerciseIds: string[]) => void;
  onRestart: () => void;
}

// Copy describes what happened (met, recognised) and never claims a word is learned.
// Counts per group live in the recap headings, so the lead stays one sentence.
// A no-break space keeps each number on the same line as its noun.
function describe(kind: SessionKind, total: number, perfect: boolean) {
  if (kind === 'lesson') {
    const met = `Вы познакомились с ${total}\u00a0${plural(total, { one: 'новым словом', few: 'новыми словами', many: 'новыми словами' })}`;
    return {
      title: perfect ? 'Без единой ошибки!' : 'Урок пройден!',
      lead: perfect ? `${met} и все узнали с первого раза.` : `${met}.`,
    };
  }
  const reviewed = `Вы повторили ${total}\u00a0${plural(total, { one: 'слово', few: 'слова', many: 'слов' })}`;
  return {
    title: perfect ? 'Ошибки исправлены!' : 'Повторение пройдено',
    lead: perfect ? `${reviewed} без единой ошибки.` : `${reviewed}.`,
  };
}

function WordGroup({ title, words, status }: { title: string; words: WordOutcome[]; status: 'missed' | 'recognized' }) {
  return (
    <section className={styles.group}>
      <h2 className={styles.groupTitle}>
        {title} <span className={styles.groupCount}>{words.length}</span>
      </h2>
      <ul className={styles.words}>
        {words.map((word) => (
          <li key={word.id} className={styles.wordRow}>
            <span className={styles.thumb}>
              <Illustration id={word.illustration} className={styles.thumbArt} />
            </span>
            <span className={styles.wordText}>
              <span className={styles.word} lang="en">
                {word.word}
              </span>
              <span className={styles.translation}>{word.translation}</span>
            </span>
            <span className={styles.status} data-status={status} aria-hidden="true">
              {status === 'missed' ? <RepeatIcon /> : <CheckIcon />}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SessionSummary({ kind, exercises, results, onPracticeMistakes, onRestart }: SessionSummaryProps) {
  const summary = summarizeSession(exercises, results);
  const hasMistakes = summary.missed.length > 0;
  const { title, lead } = describe(kind, summary.total, !hasMistakes);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Announce the result: focus lands on the heading, not on a button.
  useEffect(() => headingRef.current?.focus(), []);

  return (
    <div className={styles.screen}>
      <main className={styles.main}>
        <div className={styles.layout}>
          <div className={styles.stage}>
            <CompletionBadge perfect={!hasMistakes} />
          </div>

          <div className={styles.intro}>
            <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
              {title}
            </h1>
            <p className={styles.lead}>{lead}</p>
          </div>

          <div className={styles.recap}>
            {hasMistakes && <WordGroup title="Стоит повторить" words={summary.missed} status="missed" />}
            {summary.recognized.length > 0 && (
              <WordGroup title="Узнали с первого раза" words={summary.recognized} status="recognized" />
            )}
          </div>
        </div>
      </main>

      <footer className={styles.actions}>
        <div className={styles.actionsInner}>
          {hasMistakes ? (
            <>
              <SecondaryButton type="button" className={`${styles.action} ${styles.secondary}`} onClick={onRestart}>
                Пройти урок заново
              </SecondaryButton>
              <PrimaryButton
                type="button"
                className={styles.action}
                onClick={() => onPracticeMistakes(summary.missed.map((word) => word.id))}
              >
                Повторить ошибки
              </PrimaryButton>
            </>
          ) : (
            <PrimaryButton type="button" className={styles.action} onClick={onRestart}>
              Пройти урок заново
            </PrimaryButton>
          )}
        </div>
      </footer>
    </div>
  );
}
