import { useEffect, useRef } from 'react';
import { plural } from '../i18n/plural.ts';
import { Illustration, isIllustrationId } from '../illustrations/index.tsx';
import { relativeDay } from '../lib/relativeDay.ts';
import type { Summary, SummaryWord } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { CheckIcon, RepeatIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { SecondaryButton } from '../ui/SecondaryButton.tsx';
import { CompletionBadge } from './CompletionBadge.tsx';
import styles from './SessionSummary.module.css';

interface SessionSummaryProps {
  summary: Summary;
  onPractice: () => Promise<void>;
  onNext: () => Promise<void>;
  onHome: () => void;
}

type Entry = SummaryWord;

const words = (n: number) => `${n}\u00a0${plural(n, { one: 'слово', few: 'слова', many: 'слов' })}`;

/** Words that needed help this time: rated «Снова» or «Трудно» at least once. */
export const isHard = (entry: Entry) => entry.lowest_rating <= 2;

// Copy describes what happened (met, reviewed, practised) and never claims a word is learned.
function describe(summary: Summary, hard: Entry[]) {
  if (summary.kind === 'hard') {
    return {
      title: 'Тренировка пройдена',
      lead: `Вы ещё раз прошли ${words(summary.words.length)}. Расписание повторений не меняется.`,
    };
  }
  const parts: string[] = [];
  if (summary.new_words > 0) parts.push(`новых — ${words(summary.new_words)}`);
  if (summary.reviewed_words > 0) parts.push(`повторили — ${words(summary.reviewed_words)}`);
  const next = summary.words.map((entry) => entry.next_review_at).sort()[0];
  return {
    title: hard.length === 0 ? 'Отличная память!' : 'Готово!',
    lead: `${parts.join(', ').replace(/^./, (c) => c.toUpperCase())}.${next ? ` Следующее повторение — ${relativeDay(next)}.` : ''}`,
  };
}

interface WordGroupProps {
  title: string;
  entries: Entry[];
  status: 'missed' | 'clean';
  /** When each word comes back for review. */
  showNextReview: boolean;
}

function WordGroup({ title, entries, status, showNextReview }: WordGroupProps) {
  return (
    <section className={styles.group}>
      <h2 className={styles.groupTitle}>
        {title} <span className={styles.groupCount}>{entries.length}</span>
      </h2>
      <ul className={styles.words}>
        {entries.map(({ word, next_review_at }) => (
          <li key={word.id} className={styles.wordRow}>
            <span className={styles.thumb} data-art={isIllustrationId(word.illustration) || undefined}>
              {isIllustrationId(word.illustration) ? (
                <Illustration id={word.illustration} className={styles.thumbArt} />
              ) : (
                <span className={styles.initial} aria-hidden="true">
                  {word.headword.charAt(0)}
                </span>
              )}
            </span>
            <span className={styles.wordText}>
              <span className={styles.word} lang="en">
                {word.headword}
              </span>
              <span className={styles.translation}>{word.translation}</span>
            </span>
            {showNextReview && (
              <span className={styles.nextReview}>
                <span className="visually-hidden">Следующее повторение </span>
                {relativeDay(next_review_at)}
              </span>
            )}
            <span className={styles.status} data-status={status} aria-hidden="true">
              {status === 'missed' ? <RepeatIcon /> : <CheckIcon />}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SessionSummary({ summary, onPractice, onNext, onHome }: SessionSummaryProps) {
  const hard = summary.words.filter(isHard);
  const easy = summary.words.filter((entry) => !isHard(entry));
  const perfect = hard.length === 0;
  const { title, lead } = describe(summary, hard);
  const { run, busy, error } = useAsyncAction();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { again, hard: hardCount, good, easy: easyCount } = summary.ratings;

  // Announce the result: focus lands on the heading, not on a button.
  useEffect(() => headingRef.current?.focus(), []);

  return (
    <div className={styles.screen}>
      <main className={styles.main}>
        <div className={styles.layout}>
          <div className={styles.stage}>
            <CompletionBadge perfect={perfect} />
          </div>

          <div className={styles.intro}>
            <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
              {title}
            </h1>
            <p className={styles.lead}>{lead}</p>
            <p className={styles.points}>
              <strong>+{summary.points}</strong> {plural(summary.points, { one: 'очко', few: 'очка', many: 'очков' })}
              <span aria-hidden="true"> · </span>
              {summary.today_points >= summary.daily_goal
                ? 'цель на сегодня выполнена'
                : `до цели на сегодня ${summary.daily_goal - summary.today_points}`}
            </p>
            <ul className={styles.ratings} aria-label="Ваши оценки">
              <li data-tone="again">Снова {again}</li>
              <li data-tone="hard">Трудно {hardCount}</li>
              <li data-tone="good">Хорошо {good}</li>
              <li data-tone="easy">Легко {easyCount}</li>
            </ul>
          </div>

          <div className={styles.recap}>
            {hard.length > 0 && <WordGroup title="Трудные сейчас" entries={hard} status="missed" showNextReview />}
            {easy.length > 0 && <WordGroup title="Запомнились" entries={easy} status="clean" showNextReview />}
          </div>
        </div>
      </main>

      <footer className={styles.actions}>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.actionsInner}>
          <SecondaryButton type="button" className={`${styles.action} ${styles.secondary}`} onClick={onHome}>
            На главную
          </SecondaryButton>
          <PrimaryButton
            type="button"
            className={styles.action}
            disabled={busy}
            aria-busy={busy}
            onClick={() => run(perfect || summary.kind === 'hard' ? onNext : onPractice)}
          >
            {busy ? 'Загружаем…' : perfect || summary.kind === 'hard' ? 'Продолжить' : 'Повторить трудные'}
          </PrimaryButton>
        </div>
      </footer>
    </div>
  );
}
