import type { DeckProgress, Knowledge as KnowledgeData, Progress } from '../lib/types.ts';
import { ForwardIcon } from '../ui/icons.tsx';
import { WeekDays } from './Consistency.tsx';
import { WordCount, WordStages } from './WordStages.tsx';
import styles from './Knowledge.module.css';
import { t } from '../i18n/index.ts';

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
        {t.summary}
      </h2>
      {/* The numbers as a stats row, each with its word under it; nothing before the first lesson. */}
      {data.met > 0 ? (
        <dl className={styles.stats}>
          <div>
            <dt>{t.statKnown}</dt>
            <dd>{data.learned}</dd>
          </div>
          <div>
            <dt>{t.statThisWeek}</dt>
            <dd>{data.learned_this_week > 0 ? `+${data.learned_this_week}` : 0}</dd>
          </div>
          <div>
            <dt>{t.statLearning}</dt>
            <dd>{learning}</dd>
          </div>
        </dl>
      ) : (
        <p className={styles.hero}>{t.startYourFirstDeck}</p>
      )}
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
        {t.decks}
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
