import type { PaceSuggestion } from '../lib/types.ts';
import { wordsLabel } from '../lib/pace.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { SecondaryButton } from '../ui/SecondaryButton.tsx';
import styles from './SuggestionCard.module.css';
import { t } from '../i18n/index.ts';

interface SuggestionCardProps {
  suggestion: PaceSuggestion;
  target: number;
  onAccept: (value: number) => Promise<void>;
  onDismiss: () => Promise<void>;
}

function message(suggestion: PaceSuggestion): { title: string; body: string } {
  const value = wordsLabel(suggestion.value);
  if (suggestion.kind === 'raise') {
    return {
      title: t.readyForMore,
      body: t.suggestMore(suggestion.recall_percent ?? 0, value),
    };
  }
  if (suggestion.reason === 'low_recall') {
    return {
      title: t.aLittleSlowerAndTheWords,
      body: t.suggestLess(suggestion.recall_percent ?? 0, value),
    };
  }
  const achieved = Math.round(suggestion.achieved_per_day ?? suggestion.value);
  return {
    title: t.shallWeFindAPaceThat,
    body: t.suggestMatch(wordsLabel(achieved), value),
  };
}

/** A pace suggestion from the server. Nothing changes until the learner accepts. */
export function SuggestionCard({ suggestion, target, onAccept, onDismiss }: SuggestionCardProps) {
  const { run, busy, error } = useAsyncAction();
  const { title, body } = message(suggestion);
  return (
    <section className={styles.card} aria-labelledby="suggestion-title">
      <h2 id="suggestion-title" className={styles.title}>
        {title}
      </h2>
      <p className={styles.body}>{body}</p>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.accept}
          disabled={busy}
          onClick={() => run(() => onAccept(suggestion.value))}
        >
          {suggestion.kind === 'raise' ? t.yesADay(suggestion.value) : t.set(suggestion.value)}
        </button>
        <SecondaryButton type="button" className={styles.dismiss} disabled={busy} onClick={() => run(onDismiss)}>
          {suggestion.kind === 'raise' ? t.notNow : t.keep(target)}
        </SecondaryButton>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
