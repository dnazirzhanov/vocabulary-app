import { plural } from '../i18n/plural.ts';
import { dueLabel } from '../lib/deadline.ts';
import { deckGoal, deckStages } from '../lib/deckGoal.ts';
import type { DeckProgress, Knowledge as KnowledgeData, Progress } from '../lib/types.ts';
import { ForwardIcon } from '../ui/icons.tsx';
import { WeekDays } from './Consistency.tsx';
import styles from './Knowledge.module.css';

const wordsWord = (n: number) => plural(n, { one: 'слово', few: 'слова', many: 'слов' });
const width = (part: number, whole: number) => `${whole ? Math.min(100, (part / whole) * 100) : 0}%`;

/**
 * The answer at a glance (ADR 0034): how many words I know — recalled a day or more after meeting
 * them — what this week added, how many I'm still learning, and the week's days.
 */
export function Summary({ data, progress }: { data: KnowledgeData; progress: Progress }) {
  const learning = Math.max(0, data.met - data.learned);
  return (
    <section aria-labelledby="summary-heading" className={styles.summary}>
      <h2 id="summary-heading" className="visually-hidden">
        Итог
      </h2>
      {data.learned > 0 ? (
        <p className={styles.hero}>
          Вы знаете <strong>{data.learned}</strong> {wordsWord(data.learned)}
        </p>
      ) : (
        <p className={styles.hero}>
          {learning > 0 ? `Вы учите ${learning} ${wordsWord(learning)}` : 'Начните первую колоду'}
        </p>
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
      <WeekDays progress={progress} />
    </section>
  );
}

/** Each deck I've started, as a card: how far along, in plain stages, and its goal. */
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
  const input = { ...deck, deadline: deck.due_on ? `к ${dueLabel(deck.due_on)}` : null };
  const goal = deckGoal(input);
  const stages = deckStages(input);
  return (
    <li>
      <button type="button" className={styles.card} onClick={onOpen}>
        <span className={styles.cardHead}>
          <strong className={styles.cardTitle}>{deck.title}</strong>
          <span className={styles.count}>
            {deck.met}&nbsp;/&nbsp;{deck.word_count}
          </span>
        </span>
        {/* Two tones: words I know (strong) inside words met (light); the line below names them. */}
        <span className={styles.bar} role="img" aria-label={stages}>
          <span data-tone="met" style={{ width: width(deck.met, deck.word_count) }} />
          <span data-tone="learned" style={{ width: width(deck.learned, deck.word_count) }} />
        </span>
        <span className={styles.stages}>{stages}</span>
        {goal.text && (
          <span className={styles.goal} data-pending={goal.pending || undefined}>
            {goal.text}
          </span>
        )}
        <ForwardIcon className={styles.chevron} aria-hidden="true" />
      </button>
    </li>
  );
}
