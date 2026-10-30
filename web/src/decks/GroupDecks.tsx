import { dueLabel } from '../lib/deadline.ts';
import { plural } from '../i18n/plural.ts';
import { wordsLabel } from '../lib/pace.ts';
import type { Assignment, Board } from '../lib/types.ts';
import styles from './GroupDecks.module.css';

const dayMonth = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' });
const share = (part: number, whole: number) => `${whole ? Math.min(100, (part / whole) * 100) : 0}%`;
const learnersOf = (n: number) => `${n}\u00a0${plural(n, { one: 'участника', few: 'участников', many: 'участников' })}`;

interface GroupDecksProps {
  board: Board;
  /** The author opens their deck in the editor (decks are written in «Мои колоды», ADR 0019). */
  onOpenDeck: (deckId: string) => void;
}

/**
 * Decks given to the group and how far the group has got with each (ADR 0017, 0019). Everyone sees
 * their own progress and the group's together; the owner also sees each member's, listed by name
 * rather than by number, since the board ranks promises kept, never volume.
 */
export function GroupDecks({ board, onOpenDeck }: GroupDecksProps) {
  const owner = board.group.role === 'owner';
  if (board.assignments.length === 0) {
    if (!owner) return null;
    return (
      <section className={styles.section} aria-labelledby="group-decks-title">
        <h2 id="group-decks-title" className={styles.title}>
          Колоды группы
        </h2>
        <p className={styles.hint}>
          Пока ни одной. Создайте колоду на главной, в «Мои колоды», и нажмите в ней «Дать группе» — участники найдут её
          у себя в «Мои колоды» и будут учить в своём темпе.
        </p>
      </section>
    );
  }
  const nicknames = new Map(board.rows.map((row) => [row.member_id, row.nickname]));
  const me = board.rows.find((row) => row.is_me)?.member_id;
  return (
    <section className={styles.section} aria-labelledby="group-decks-title">
      <h2 id="group-decks-title" className={styles.title}>
        Колоды группы
      </h2>
      <ul className={styles.list}>
        {board.assignments.map((assignment) => (
          <DeckProgress
            key={assignment.deck_id}
            assignment={assignment}
            nicknames={nicknames}
            me={me}
            onEdit={assignment.is_mine ? () => onOpenDeck(assignment.deck_id) : null}
          />
        ))}
      </ul>
    </section>
  );
}

function DeckProgress({
  assignment,
  nicknames,
  me,
  onEdit,
}: {
  assignment: Assignment;
  nicknames: Map<string, string>;
  me: string | undefined;
  onEdit: (() => void) | null;
}) {
  const { title, word_count: total, mine, group, members } = assignment;
  const source = assignment.is_mine ? 'ваша колода' : assignment.author ? `от ${assignment.author}` : null;
  // The owner's own row comes first, as «Вы»; the rest by name.
  const learners = (members ?? [])
    .map((member) => ({
      ...member,
      isMe: member.member_id === me,
      name: member.member_id === me ? 'Вы' : (nicknames.get(member.member_id) ?? ''),
    }))
    .sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.name.localeCompare(b.name, 'ru'));
  return (
    <li className={styles.item}>
      <div className={styles.itemHead}>
        <div className={styles.itemText}>
          <span className={styles.itemTitle}>{title}</span>
          <span className={styles.meta}>
            {[
              source,
              wordsLabel(total),
              assignment.due_on
                ? `выучить к ${dueLabel(assignment.due_on)}`
                : `задано ${dayMonth.format(new Date(assignment.assigned_at))}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        {onEdit && (
          <button type="button" className={styles.linkButton} onClick={onEdit}>
            Изменить
          </button>
        )}
      </div>

      {/* The owner finds their own progress as the first row of the list below. */}
      {learners.length === 0 && (
        <div className={styles.mine}>
          <p>
            Вы встретили <strong>{mine}</strong> из {total}
          </p>
          <Bar label={`«${title}»: вы встретили`} value={mine} max={total} />
        </div>
      )}

      <p className={styles.groupLine}>
        Группа: встречено {group.met} из {group.total} · все слова встретили {group.finished} из{' '}
        {learnersOf(group.learners)}
      </p>

      {learners.length > 0 && (
        <ul className={styles.learners} aria-label={`Участники: «${title}»`}>
          {learners.map((learner) => (
            <li key={learner.member_id} className={styles.learner}>
              <span className={styles.name} data-me={learner.isMe || undefined}>
                {learner.name}
              </span>
              <span className={styles.miniBar} aria-hidden="true">
                <span className={styles.miniMet} style={{ width: share(learner.met, total) }} />
                <span className={styles.miniKnown} style={{ width: share(learner.known, total) }} />
              </span>
              <span className={styles.count} data-done={(total > 0 && learner.met >= total) || undefined}>
                {learner.met} из {total}
                {learner.known > 0 && <span className={styles.known}> · помнит {learner.known}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div
      className={styles.track}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <span style={{ width: share(value, max) }} />
    </div>
  );
}
