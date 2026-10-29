import { plural } from '../i18n/plural.ts';
import type { DeckProgress, Knowledge as KnowledgeData } from '../lib/types.ts';
import { ForwardIcon } from '../ui/icons.tsx';
import styles from './Knowledge.module.css';

const wordsOf = (n: number) => `${n}\u00a0${plural(n, { one: 'слово', few: 'слова', many: 'слов' })}`;
const share = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
const width = (part: number, whole: number) => `${whole ? Math.min(100, (part / whole) * 100) : 0}%`;

/**
 * «Do I actually remember?» (ADR 0022): words learned — recalled in a later review, not just
 * seen — in all and deck by deck. The bar's tones: known well (darkest), learned, met (faint).
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
      <p className={styles.sub}>
        Надёжно — {data.known} · встречено — {data.met}
      </p>
      {data.decks.length === 0 ? (
        <p className={styles.empty}>
          Пока ничего не выучено. Слово считается выученным, когда вы вспомните его на повторении — через день или
          позже.
        </p>
      ) : (
        <>
          <p className={styles.legend} aria-hidden="true">
            <i data-tone="known" /> надёжно <i data-tone="learned" /> выучено <i data-tone="met" /> встречено
          </p>
          <ul className={styles.list}>
            {data.decks.map((deck) => (
              <DeckRow key={deck.id} deck={deck} onOpen={() => onOpenDeck(deck.id)} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function DeckRow({ deck, onOpen }: { deck: DeckProgress; onOpen: () => void }) {
  const source = deck.is_mine
    ? 'ваша колода'
    : deck.author
      ? `от ${deck.author} · ${deck.group_name}`
      : (deck.group_name ?? deck.level ?? '');
  const percent = share(deck.learned, deck.word_count);
  return (
    <li>
      <button type="button" className={styles.row} onClick={onOpen}>
        <span className={styles.rowHead}>
          <span className={styles.rowText}>
            <strong>{deck.title}</strong>
            <span className={styles.meta}>{source}</span>
          </span>
          <span className={styles.percent}>{percent}&nbsp;%</span>
        </span>
        <span
          className={styles.bar}
          role="img"
          aria-label={`Выучено ${deck.learned} из ${wordsOf(deck.word_count)}, надёжно ${deck.known}, встречено ${deck.met}`}
        >
          <span data-tone="met" style={{ width: width(deck.met, deck.word_count) }} />
          <span data-tone="learned" style={{ width: width(deck.learned, deck.word_count) }} />
          <span data-tone="known" style={{ width: width(deck.known, deck.word_count) }} />
        </span>
        <span className={styles.counts}>
          выучено {deck.learned} из {wordsOf(deck.word_count)}
          {deck.known > 0 && ` · надёжно ${deck.known}`}
        </span>
        <ForwardIcon className={styles.chevron} aria-hidden="true" />
      </button>
    </li>
  );
}
