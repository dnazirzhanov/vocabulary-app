import type { DeckProgress, Knowledge as KnowledgeData, Progress } from '../lib/types.ts';
import { ForwardIcon } from '../ui/icons.tsx';
import { WeekDays } from './Consistency.tsx';
import { WordCount, WordStages } from './WordStages.tsx';
import styles from './Knowledge.module.css';

/**
 * The answer at a glance (ADR 0034): how many words I know — recalled a day or more after meeting
 * them — what this week added, how many I'm still learning, and the week's days.
 */
export function Summary({
  data,
  progress,
  onPromiseChanged,
}: {
  data: KnowledgeData;
  progress: Progress;
  onPromiseChanged?: () => void;
}) {
  const learning = Math.max(0, data.met - data.learned);
  return (
    <section aria-labelledby="summary-heading" className={styles.summary}>
      <h2 id="summary-heading" className="visually-hidden">
        Итог
      </h2>
      {data.learned > 0 ? (
        <p className={styles.hero}>
          {/* «Слов: N» is plural whatever the number; «21 слов» would be wrong Russian. */}
          Вы знаете слов: <strong>{data.learned}</strong>
        </p>
      ) : (
        <p className={styles.hero}>{learning > 0 ? `Вы учите слов: ${learning}` : 'Начните первую колоду'}</p>
      )}
      <p className={styles.sub}>
        {data.learned > 0
          ? [
              data.learned_this_week > 0 && `+${data.learned_this_week} за эту неделю`,
              learning > 0 && `ещё ${learning} учите`,
            ]
              .filter(Boolean)
              .join(' · ')
          : 'Слово становится знакомым, когда вы вспомните его на повторении — через день или позже.'}
      </p>
      <WeekDays progress={progress} onPromiseChanged={onPromiseChanged} />
    </section>
  );
}

/** Each deck I've started, as a card: its name, how far along, and its stages. */
export function Decks({ data, onOpenDeck }: { data: KnowledgeData; onOpenDeck: (deckId: string) => void }) {
  if (data.decks.length === 0) return null;
  return (
    <section aria-labelledby="decks-heading" className={styles.section}>
      <h2 id="decks-heading" className={styles.sectionTitle}>
        Колоды
      </h2>
      <ul className={styles.list}>
        {data.decks.map((deck) => (
          <DeckCard key={deck.id} deck={deck} onOpen={() => onOpenDeck(deck.id)} />
        ))}
      </ul>
    </section>
  );
}

function DeckCard({ deck, onOpen }: { deck: DeckProgress; onOpen: () => void }) {
  return (
    <li>
      <button type="button" className={styles.card} onClick={onOpen}>
        <span className={styles.cardHead}>
          <strong className={styles.cardTitle}>{deck.title}</strong>
          <WordCount met={deck.met} total={deck.word_count} />
        </span>
        <WordStages met={deck.met} learned={deck.learned} total={deck.word_count} />
        <ForwardIcon className={styles.chevron} aria-hidden="true" />
      </button>
    </li>
  );
}
