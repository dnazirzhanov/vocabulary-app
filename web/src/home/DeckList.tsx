import type { Deck } from '../lib/types.ts';
import { ForwardIcon, LockIcon } from '../ui/icons.tsx';
import styles from './CourseScreen.module.css';

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
          Уровни
        </h2>
        {/* Anki's short column names; each number repeats its full name for screen readers. */}
        <span className={`${styles.colHead} ${styles.fresh}`} aria-hidden="true">
          Нов.
        </span>
        <span className={`${styles.colHead} ${styles.learning}`} aria-hidden="true">
          Изуч.
        </span>
        <span className={`${styles.colHead} ${styles.review}`} aria-hidden="true">
          Повт.
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
                    `после уровня «${decks[index - 1].title}»`
                  ) : (
                    <span className={styles.nowrap}>{`${deck.introduced_count} из ${deck.word_count}`}</span>
                  )}
                </span>
              </span>
              {deck.locked ? (
                <span className={styles.locked}>
                  <LockIcon aria-hidden="true" />
                  <span className="visually-hidden">закрыта</span>
                </span>
              ) : (
                <>
                  <Count value={deck.new_today} className={styles.fresh} name="новых" />
                  <Count value={deck.learning_count} className={styles.learning} name="изучаемых" />
                  <Count value={deck.review_count} className={styles.review} name="к повторению" />
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
