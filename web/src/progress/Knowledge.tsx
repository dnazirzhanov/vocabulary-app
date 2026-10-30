import { plural } from '../i18n/plural.ts';
import { dueLabel } from '../lib/deadline.ts';
import { deckGoal } from '../lib/deckGoal.ts';
import type { DeckProgress, Knowledge as KnowledgeData } from '../lib/types.ts';
import { ForwardIcon } from '../ui/icons.tsx';
import styles from './Knowledge.module.css';

const wordsOf = (n: number) => `${n}\u00a0${plural(n, { one: 'слово', few: 'слова', many: 'слов' })}`;
const width = (part: number, whole: number) => `${whole ? Math.min(100, (part / whole) * 100) : 0}%`;

/**
 * «Do I actually remember?» (ADR 0022, 0033): words learned — recalled in a later review, not
 * just seen — and how many of them are solid; then each deck in two lines: how far along, and its
 * goal (today's words, and the finish at its pace or the teacher's deadline).
 */
export function Knowledge({ data, onOpenDeck }: { data: KnowledgeData; onOpenDeck: (deckId: string) => void }) {
  return (
    <section aria-labelledby="knowledge-heading" className={styles.section}>
      <h2 id="knowledge-heading" className={styles.sectionTitle}>
        Знания
      </h2>
      <p className={styles.hero}>
        <strong>{data.learned}</strong>{' '}
        <span>{plural(data.learned, { one: 'слово', few: 'слова', many: 'слов' })} выучено</span>
      </p>
      {data.known > 0 && <p className={styles.sub}>из них надёжно — {data.known}</p>}
      {data.decks.length === 0 ? (
        <p className={styles.empty}>
          Пока ничего не выучено. Слово считается выученным, когда вы вспомните его на повторении — через день или
          позже.
        </p>
      ) : (
        <ul className={styles.list}>
          {data.decks.map((deck) => (
            <DeckRow key={deck.id} deck={deck} onOpen={() => onOpenDeck(deck.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function DeckRow({ deck, onOpen }: { deck: DeckProgress; onOpen: () => void }) {
  const goal = deckGoal({ ...deck, deadline: deck.due_on ? `к ${dueLabel(deck.due_on)}` : null });
  return (
    <li>
      <button type="button" className={styles.row} onClick={onOpen}>
        <strong className={styles.rowTitle}>{deck.title}</strong>
        {/* Two tones: met (light), learned (strong) — named in the line under it, in that order. */}
        <span
          className={styles.bar}
          role="img"
          aria-label={`Выучено ${deck.learned}, встречено ${deck.met} из ${wordsOf(deck.word_count)}`}
        >
          <span data-tone="met" style={{ width: width(deck.met, deck.word_count) }} />
          <span data-tone="learned" style={{ width: width(deck.learned, deck.word_count) }} />
        </span>
        <span className={styles.counts}>
          выучено <strong>{deck.learned}</strong> · встречено {deck.met} из {wordsOf(deck.word_count)}
        </span>
        <span className={styles.goal} data-pending={goal.pending || undefined}>
          {goal.text}
        </span>
        <ForwardIcon className={styles.chevron} aria-hidden="true" />
      </button>
    </li>
  );
}
