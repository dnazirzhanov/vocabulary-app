import { dueLabel } from '../lib/deadline.ts';
import { wordsLabel } from '../lib/pace.ts';
import type { Board } from '../lib/types.ts';
import styles from './GroupDecks.module.css';

interface GroupDecksProps {
  board: Board;
  /** The author opens their deck in the editor (decks are written in «Мои колоды», ADR 0019). */
  onOpenDeck: (deckId: string) => void;
}

/**
 * Decks given to the group, folded under «Управление группой» (ADR 0032): name, size, deadline,
 * and «Изменить» for its author. Readiness for the class is on the page itself, under «К уроку».
 */
export function GroupDecks({ board, onOpenDeck }: GroupDecksProps) {
  const owner = board.group.can.includes('give_decks');
  if (board.assignments.length === 0) {
    if (!owner) return null;
    return (
      <p className={styles.hint}>
        Колод пока нет. Создайте колоду в «Мои колоды» и нажмите в ней «Дать группе» — участники найдут её у себя.
      </p>
    );
  }
  return (
    <section className={styles.section} aria-labelledby="group-decks-title">
      <h3 id="group-decks-title" className={styles.title}>
        Колоды группы
      </h3>
      <ul className={styles.list}>
        {board.assignments.map((assignment) => (
          <li key={assignment.deck_id} className={styles.item}>
            <span>
              <strong>{assignment.title}</strong>
              <span className={styles.meta}>
                {' '}
                · {wordsLabel(assignment.word_count)}
                {assignment.due_on && ` · к ${dueLabel(assignment.due_on)}`}
              </span>
            </span>
            {assignment.is_mine && (
              <button type="button" className={styles.linkButton} onClick={() => onOpenDeck(assignment.deck_id)}>
                Изменить
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
