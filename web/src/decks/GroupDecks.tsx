import { api } from '../lib/api.ts';
import { wordsLabel } from '../lib/pace.ts';
import type { Assignment, Board } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { PencilIcon } from '../ui/icons.tsx';
import styles from './GroupDecks.module.css';

const dayMonth = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' });

interface GroupDecksProps {
  board: Board;
  /** Opens a deck in the editor (the owner's own decks only). */
  onOpenDeck: (deckId: string) => void;
}

/**
 * Words the group's teacher gave it (ADR 0017). A member sees how many of each deck they have met;
 * the owner sees every learner's count, by name rather than by number, since the board ranks
 * promises kept, never volume. The owner also starts a deck here; unfinished ones wait in «Мои колоды».
 */
export function GroupDecks({ board, onOpenDeck }: GroupDecksProps) {
  const owner = board.group.role === 'owner';
  const { run, busy, error } = useAsyncAction();

  if (!owner && board.assignments.length === 0) return null;
  const nicknames = new Map(board.rows.map((row) => [row.member_id, row.nickname]));
  const start = () =>
    run(async () => {
      const deck = await api.createDeck(`Слова к уроку ${dayMonth.format(new Date())}`, board.group.id);
      onOpenDeck(deck.id);
    });

  return (
    <section className={styles.section} aria-labelledby="group-decks-title">
      <div className={styles.head}>
        <h2 id="group-decks-title" className={styles.title}>
          Слова для группы
        </h2>
        {owner && (
          <button type="button" className={styles.outlineButton} disabled={busy} onClick={start}>
            <PencilIcon aria-hidden="true" />
            Дать слова группе
          </button>
        )}
      </div>
      {owner && board.assignments.length === 0 && (
        <p className={styles.hint}>
          Соберите слова к уроку — ученики встретят их первыми в своём ежедневном уроке, в своём темпе.
        </p>
      )}
      {error && (
        <p className={styles.problem} role="alert">
          {error}
        </p>
      )}
      <ul className={styles.list}>
        {board.assignments.map((assignment) => (
          <AssignmentItem
            key={assignment.deck_id}
            assignment={assignment}
            nicknames={nicknames}
            onOpen={owner ? () => onOpenDeck(assignment.deck_id) : null}
          />
        ))}
      </ul>
    </section>
  );
}

function AssignmentItem({
  assignment,
  nicknames,
  onOpen,
}: {
  assignment: Assignment;
  nicknames: Map<string, string>;
  onOpen: (() => void) | null;
}) {
  const { title, word_count: total, mine, members } = assignment;
  const learners = (members ?? [])
    .map((member) => ({ name: nicknames.get(member.member_id) ?? '', met: member.met }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const heading = (
    <>
      <span className={styles.itemTitle}>{title}</span>
      <span className={styles.meta}>
        {wordsLabel(total)} · задано {dayMonth.format(new Date(assignment.assigned_at))}
      </span>
    </>
  );
  return (
    <li className={styles.item}>
      {onOpen ? (
        <button type="button" className={styles.itemButton} onClick={onOpen}>
          {heading}
        </button>
      ) : (
        <div className={styles.itemStatic}>{heading}</div>
      )}
      <div className={styles.mine}>
        <p>
          Вы встретили <strong>{mine}</strong> из {total}
        </p>
        <div
          className={styles.track}
          role="progressbar"
          aria-label={`«${title}»: встречено слов`}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={mine}
        >
          <span style={{ width: `${total ? (mine / total) * 100 : 0}%` }} />
        </div>
      </div>
      {learners.length > 0 && (
        <ul className={styles.learners} aria-label={`Кто сколько слов встретил: «${title}»`}>
          {learners.map((learner) => (
            <li key={learner.name}>
              <span>{learner.name}</span>
              <span className={styles.count} data-done={learner.met >= total || undefined}>
                {learner.met} из {total}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
