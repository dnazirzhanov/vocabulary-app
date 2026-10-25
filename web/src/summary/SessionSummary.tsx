import { useEffect, useRef } from 'react';
import { plural } from '../i18n/plural.ts';
import { Illustration, isIllustrationId } from '../illustrations/index.tsx';
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

// Copy describes what happened (met, practised) and never claims a word is learned.
// A no-break space keeps each number on the same line as its noun.
function describe(summary: Summary, perfect: boolean) {
  const total = summary.words.length;
  if (summary.kind === 'new') {
    const met = `Вы познакомились с ${total}\u00a0${plural(total, { one: 'новым словом', few: 'новыми словами', many: 'новыми словами' })}`;
    return {
      title: perfect ? 'Без единой ошибки!' : 'Урок пройден!',
      lead: perfect ? `${met} — и ни разу не ошиблись.` : `${met}.`,
    };
  }
  const practised = `Вы повторили ${total}\u00a0${plural(total, { one: 'слово', few: 'слова', many: 'слов' })}`;
  return {
    title: perfect ? 'Ошибки исправлены!' : 'Повторение пройдено',
    lead: perfect ? `${practised} без единой ошибки.` : `${practised}.`,
  };
}

function WordGroup({ title, words, status }: { title: string; words: Word[]; status: 'missed' | 'clean' }) {
  return (
    <section className={styles.group}>
      <h2 className={styles.groupTitle}>
        {title} <span className={styles.groupCount}>{words.length}</span>
      </h2>
      <ul className={styles.words}>
        {words.map((word) => (
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
  const missed = summary.words.filter((entry) => entry.mistakes > 0).map((entry) => entry.word);
  const clean = summary.words.filter((entry) => entry.mistakes === 0).map((entry) => entry.word);
  const perfect = missed.length === 0;
  const { title, lead } = describe(summary, perfect);
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
            {missed.length > 0 && <WordGroup title="Стоит повторить" words={missed} status="missed" />}
            {clean.length > 0 && <WordGroup title="Без ошибок" words={clean} status="clean" />}
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
            {busy ? 'Загружаем…' : perfect ? 'Следующие слова' : 'Повторить ошибки'}
          </PrimaryButton>
        </div>
      </footer>
    </div>
  );
}
