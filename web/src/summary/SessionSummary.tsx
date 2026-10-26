import { useEffect, useRef } from 'react';
import { plural } from '../i18n/plural.ts';
import { Illustration, isIllustrationId } from '../illustrations/index.tsx';
import { relativeDay } from '../lib/relativeDay.ts';
import type { Summary, Word } from '../lib/types.ts';
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

type Entry = { word: Word; mistakes: number; next_review_at: string };

// Copy describes what happened (met, practised, recalled after a delay) and never claims a word
// is learned. A no-break space keeps each number on the same line as its noun.
function describe(summary: Summary, missed: Entry[]) {
  const total = summary.words.length;
  const perfect = missed.length === 0;
  const words = (n: number) => `${n}\u00a0${plural(n, { one: 'слово', few: 'слова', many: 'слов' })}`;
  if (summary.kind === 'new') {
    const met = `Вы познакомились с ${total}\u00a0${plural(total, { one: 'новым словом', few: 'новыми словами', many: 'новыми словами' })}`;
    const first = summary.words[0] ? ` Первое повторение — ${relativeDay(summary.words[0].next_review_at)}.` : '';
    return {
      title: perfect ? 'Без единой ошибки!' : 'Урок пройден!',
      lead: (perfect ? `${met} — и ни разу не ошиблись.` : `${met}.`) + first,
    };
  }
  if (summary.kind === 'review') {
    const recalled = total - missed.length;
    return {
      title: perfect ? 'Отличная память!' : 'Повторение пройдено',
      lead: perfect
        ? `Вы вспомнили все ${words(total)} спустя время.`
        : `Вы вспомнили ${recalled} из ${words(total)} спустя время. Остальные вернутся завтра.`,
    };
  }
  return {
    title: perfect ? 'Ошибки исправлены!' : 'Повторение пройдено',
    lead: perfect ? `Вы повторили ${words(total)} без единой ошибки.` : `Вы повторили ${words(total)}.`,
  };
}

interface WordGroupProps {
  title: string;
  entries: Entry[];
  status: 'missed' | 'clean';
  /** Reviews show when each word comes back; after new words it is always tomorrow. */
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
  const missed = summary.words.filter((entry) => entry.mistakes > 0);
  const clean = summary.words.filter((entry) => entry.mistakes === 0);
  const perfect = missed.length === 0;
  const review = summary.kind === 'review';
  const { title, lead } = describe(summary, missed);
  const { run, busy, error } = useAsyncAction();
  const headingRef = useRef<HTMLHeadingElement>(null);

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
          </div>

          <div className={styles.recap}>
            {missed.length > 0 && (
              <WordGroup title="Стоит повторить" entries={missed} status="missed" showNextReview={review} />
            )}
            {clean.length > 0 && (
              <WordGroup
                title={review ? 'Вспомнили' : 'Без ошибок'}
                entries={clean}
                status="clean"
                showNextReview={review}
              />
            )}
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
            onClick={() => run(perfect ? onNext : onPractice)}
          >
            {busy ? 'Загружаем…' : perfect ? 'Продолжить' : 'Повторить ошибки'}
          </PrimaryButton>
        </div>
      </footer>
    </div>
  );
}
