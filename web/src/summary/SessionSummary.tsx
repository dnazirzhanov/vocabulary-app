import { useEffect, useRef } from 'react';
import { Illustration, isIllustrationId } from '../illustrations/index.tsx';
import { wordsLabel } from '../lib/pace.ts';
import { relativeDay } from '../lib/relativeDay.ts';
import type { Summary, SummaryWord } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { CheckIcon, RepeatIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { SecondaryButton } from '../ui/SecondaryButton.tsx';
import { Celebration } from '../ui/Celebration.tsx';
import { CompletionBadge } from './CompletionBadge.tsx';
import styles from './SessionSummary.module.css';
import { t } from '../i18n/index.ts';

interface SessionSummaryProps {
  summary: Summary;
  onPractice: () => Promise<void>;
  onNext: () => Promise<void>;
  /** Today's spelling (ADR 0016): the next step after the cards, or another round. */
  onSpelling: () => Promise<void>;
  onHome: () => void;
}

type Entry = SummaryWord;

const words = (n: number) => t.wordsCount(n);

/** Words that needed help this time: rated «Снова» or «Трудно» at least once. */
export const isHard = (entry: Entry) => entry.lowest_rating <= 2;

// Copy describes what happened (met, reviewed, practised) and never claims a word is learned.
function describe(summary: Summary, hard: Entry[]) {
  if (summary.kind === 'spelling' && summary.spelling) {
    const { words: count, first_try, needs_practice } = summary.spelling;
    return {
      title: needs_practice === 0 ? t.notASingleMistake : t.spellingDone,
      // A misspelled word is hard on the spelling ladder: it comes back the next day (ADR 0026).
      lead: t.spellingLead(count, first_try, needs_practice),
    };
  }
  if (summary.kind === 'hard') {
    return {
      title: t.practiceFinished,
      lead: t.youWentThroughAgainTheReview(words(summary.words.length)),
    };
  }
  const parts: string[] = [];
  if (summary.new_words > 0) parts.push(t.newCountPart(words(summary.new_words)));
  if (summary.reviewed_words > 0) parts.push(t.reviewed(words(summary.reviewed_words)));
  const next = summary.words.map((entry) => entry.next_review_at).sort()[0];
  return {
    title: hard.length === 0 ? t.greatMemory : t.doneExclaimed,
    lead: t.lessonLead(parts, next ? relativeDay(next) : null),
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
                <span className="visually-hidden">{t.nextReview} </span>
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

export function SessionSummary({ summary, onPractice, onNext, onSpelling, onHome }: SessionSummaryProps) {
  const hard = summary.words.filter(isHard);
  const easy = summary.words.filter((entry) => !isHard(entry));
  const perfect = hard.length === 0;
  const { title, lead } = describe(summary, hard);
  const { run, busy, error } = useAsyncAction();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The next step: spelling while today's words are not yet spelled (ADR 0026), more spelling
  // while the main set holds words, practice of hard words, or more study.
  const spelling = summary.spelling_today;
  const next =
    summary.kind === 'spelling'
      ? spelling.ready > 0
        ? { label: t.moreWords(wordsLabel(spelling.ready)), run: onSpelling }
        : null
      : summary.kind === 'study' && spelling.paused
        ? { label: t.continueSpellingMore(spelling.paused.total - spelling.paused.spelled), run: onSpelling }
        : summary.kind === 'study' && spelling.today_left > 0
          ? { label: t.spelling(wordsLabel(spelling.ready)), run: onSpelling }
          : perfect || summary.kind === 'hard'
            ? { label: t.continue, run: onNext }
            : { label: t.reviewTheHardOnes, run: onPractice };

  // Announce the result: focus lands on the heading, not on a button.
  useEffect(() => headingRef.current?.focus(), []);

  return (
    <div className={styles.screen}>
      <Celebration />
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
            {hard.length > 0 && <WordGroup title={t.hardRightNow} entries={hard} status="missed" showNextReview />}
            {easy.length > 0 && <WordGroup title={t.remembered} entries={easy} status="clean" showNextReview />}
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
          {next?.run === onSpelling && summary.kind === 'study' && !perfect && (
            <button type="button" className={styles.practiceLink} disabled={busy} onClick={() => run(onPractice)}>
              {t.reviewTheHardOnes}
            </button>
          )}
          {next ? (
            <>
              <SecondaryButton type="button" className={`${styles.action} ${styles.secondary}`} onClick={onHome}>
                {t.home}
              </SecondaryButton>
              <PrimaryButton
                type="button"
                className={styles.action}
                disabled={busy}
                aria-busy={busy}
                onClick={() => run(next.run)}
              >
                {busy ? t.loading : next.label}
              </PrimaryButton>
            </>
          ) : (
            // Everything spelled for now: home is the only step left.
            <PrimaryButton type="button" className={styles.action} onClick={onHome}>
              {t.home}
            </PrimaryButton>
          )}
        </div>
      </footer>
    </div>
  );
}
