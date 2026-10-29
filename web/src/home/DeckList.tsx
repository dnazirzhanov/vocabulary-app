import type { Deck } from '../lib/types.ts';
import { ForwardIcon, LockIcon } from '../ui/icons.tsx';
import styles from './HomeScreen.module.css';

/**
 * The course's levels as Anki's deck list: per deck, today's new words, cards in learning steps
 * and reviews due. Tapping a deck studies it; a locked level says what opens it (ADR 0014).
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
          Колоды
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
                  {deck.group_name && `${sourceOf(deck)} · `}
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

/** Where a teacher's deck comes from, in a few words: mine, someone's, or just the group. */
function sourceOf(deck: Deck): string {
  if (deck.is_mine) return `ваш набор · ${deck.group_name}`;
  if (deck.author) return `от ${deck.author} · ${deck.group_name}`;
  return `группа ${deck.group_name}`;
}

function Count({ value, className, name }: { value: number; className: string; name: string }) {
  return (
    <span className={`${styles.count} ${className}`} data-zero={value === 0 || undefined}>
      {value}
      <span className="visually-hidden"> {name}</span>
    </span>
  );
}
