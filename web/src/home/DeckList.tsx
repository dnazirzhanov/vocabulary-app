import type { Deck } from '../lib/types.ts';
import { ForwardIcon, LockIcon } from '../ui/icons.tsx';
import styles from './CourseScreen.module.css';
import { t } from '../i18n/index.ts';

/**
 * The course's levels as Anki's deck list: per deck, today's new words, cards in learning steps
 * and reviews due. Tapping a deck opens its page (ADR 0020); a locked level says what opens it.
 */
export function DeckList({
  decks,
  busy,
  onStart,
}: {
  decks: Deck[];
  busy: boolean;
  onStart: (deckId: string) => void;
}) {
  return (
    <section className={styles.decks} aria-labelledby="decks-title">
      <div className={styles.deckGrid}>
        <h2 id="decks-title" className={styles.sectionTitle}>
          {t.levels}
        </h2>
        {/* Anki's short column names; each number repeats its full name for screen readers. */}
        <span className={`${styles.colHead} ${styles.fresh}`} aria-hidden="true">
          {t.new}
        </span>
        <span className={`${styles.colHead} ${styles.learning}`} aria-hidden="true">
          {t.lrn}
        </span>
        <span className={`${styles.colHead} ${styles.review}`} aria-hidden="true">
          {t.rev}
        </span>
      </div>
      <ul className={styles.deckList}>
        {decks.map((deck, index) => (
          <li key={deck.id}>
            <button
              type="button"
              className={`${styles.deckGrid} ${styles.deckRow}`}
              data-locked={deck.locked || undefined}
              disabled={deck.locked || busy}
              onClick={() => onStart(deck.id)}
            >
              <span className={styles.deckName}>
                <strong>{deck.title}</strong>
                <span className={styles.deckMeta}>
                  {deck.level && `${deck.level} · `}
                  {deck.locked && index > 0 ? (
                    t.afterTheLevel(decks[index - 1].title)
                  ) : (
                    <span className={styles.nowrap}>{t.of(deck.introduced_count, deck.word_count)}</span>
                  )}
                </span>
              </span>
              {deck.locked ? (
                <span className={styles.locked}>
                  <LockIcon aria-hidden="true" />
                  <span className="visually-hidden">{t.locked}</span>
                </span>
              ) : (
                <>
                  <Count value={deck.new_today} className={styles.fresh} name={t.newWords} />
                  <Count value={deck.learning_count} className={styles.learning} name={t.inLearning} />
                  <Count value={deck.review_count} className={styles.review} name={t.toReviewLabel} />
                </>
              )}
              {!deck.locked && <ForwardIcon className={styles.chevron} aria-hidden="true" />}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Count({ value, className, name }: { value: number; className: string; name: string }) {
  return (
    <span className={`${styles.count} ${className}`} data-zero={value === 0 || undefined}>
      {value}
      <span className="visually-hidden"> {name}</span>
    </span>
  );
}
