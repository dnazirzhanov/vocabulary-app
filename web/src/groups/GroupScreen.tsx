import { useCallback, useEffect, useRef, useState } from 'react';
import { plural, weeksWord } from '../i18n/plural.ts';
import { api, describeError } from '../lib/api.ts';
import { ranked, standingOf, visibleLines, type Measure, type Standing } from '../lib/board.ts';
import { dueLabel, standingLabel } from '../lib/deadline.ts';
import type { Assignment, Board, BoardRow } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { BackIcon, CheckIcon, PersonPlusIcon } from '../ui/icons.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { SecondaryButton } from '../ui/SecondaryButton.tsx';
import { GroupDecks } from '../decks/GroupDecks.tsx';
import { InviteDialog } from './InviteDialog.tsx';
import shared from './Groups.module.css';
import styles from './Group.module.css';

const number = new Intl.NumberFormat('ru');
const count = (n: number, one: string, few: string, many: string) =>
  `${number.format(n)}\u00a0${plural(n, { one, few, many })}`;
const daysOf = (n: number) => count(n, 'день', 'дня', 'дней');
const wordsOf = (n: number) => count(n, 'слово', 'слова', 'слов');
const membersOf = (n: number) => count(n, 'участник', 'участника', 'участников');

interface GroupScreenProps {
  groupId: string;
  /** Open the invitation straight away: the group has just been created. */
  inviteOnOpen?: boolean;
  /** The author opens their deck, given to this group, in the editor (ADR 0019). */
  onOpenDeck: (deckId: string) => void;
  /** A member opens a deck with a deadline to study it. */
  onStudyDeck: (deckId: string) => void;
  onBack: () => void;
  onLeft: () => void;
}

/**
 * One group (ADR 0023, 0032), only what a member acts on: where I am this week and the one step
 * to the next place; whether I'm ready for the class (the teacher: who isn't); and the week's
 * league, one number a person, a ✓ for who studied today. Everything else is a tap away: a
 * person's figures in their window, the rule in «Как считаются места?», housekeeping folded at
 * the bottom.
 */
export function GroupScreen({
  groupId,
  inviteOnOpen = false,
  onOpenDeck,
  onStudyDeck,
  onBack,
  onLeft,
}: GroupScreenProps) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(inviteOnOpen);
  const [person, setPerson] = useState<BoardRow | null>(null);
  const [rules, setRules] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(
    () => api.board(groupId, 'week').then(setBoard, (caught: unknown) => setError(describeError(caught))),
    [groupId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const focused = useRef(false);
  useEffect(() => {
    if (!board || focused.current) return;
    focused.current = true;
    headingRef.current?.focus();
  }, [board]);

  if (error) {
    return (
      <main className="message-screen">
        <p role="alert">{error}</p>
        <PrimaryButton type="button" onClick={() => (setError(null), void load())}>
          Повторить
        </PrimaryButton>
      </main>
    );
  }
  if (!board) {
    return (
      <main className="message-screen" aria-busy="true">
        <p>Загружаем…</p>
      </main>
    );
  }

  const { group } = board;
  const owner = group.role === 'owner';
  const forClass = board.assignments.filter((assignment) => assignment.due_on);

  return (
    <div className={shared.screen}>
      <header className={shared.topbar}>
        <button type="button" className={shared.back} onClick={onBack}>
          <BackIcon aria-hidden="true" /> Друзья
        </button>
      </header>
      <main className={shared.main}>
        <div className={`${shared.column} ${styles.page}`}>
          <div className={styles.head}>
            <h1 ref={headingRef} tabIndex={-1} className={shared.title}>
              {group.name}
            </h1>
            <button
              type="button"
              className={styles.invite}
              onClick={() => setInviting(true)}
              aria-label="Пригласить"
              title="Пригласить"
            >
              <PersonPlusIcon aria-hidden="true" />
            </button>
          </div>

          <YourWeek standing={standingOf(board.rows)} />

          {forClass.length > 0 && (
            <section aria-labelledby="class-title" className={styles.section}>
              <h2 id="class-title" className={styles.sectionTitle}>
                К уроку
              </h2>
              <ul className={styles.forClass}>
                {forClass.map((assignment) => (
                  <ForClass
                    key={assignment.deck_id}
                    assignment={assignment}
                    board={board}
                    owner={owner}
                    onStudy={() => onStudyDeck(assignment.deck_id)}
                  />
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="league-title" className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 id="league-title" className={styles.sectionTitle}>
                Неделя
              </h2>
              <button type="button" className={shared.linkButton} onClick={() => setRules(true)}>
                Как считаются места?
              </button>
            </div>
            <League rows={board.rows} onOpen={setPerson} />
          </section>

          <details className={styles.manage}>
            <summary>Управление группой</summary>
            <div className={styles.manageBody}>
              <GroupDecks board={board} onOpenDeck={onOpenDeck} />
              <Housekeeping board={board} onRemoved={() => void load()} onLeft={onLeft} />
            </div>
          </details>
        </div>
      </main>
      <InviteDialog
        code={group.invite_code}
        groupName={group.name}
        open={inviting}
        onClose={() => setInviting(false)}
      />
      <Dialog open={rules} onClose={() => setRules(false)} title="Как считаются места">
        <p className={styles.dialogText}>
          Каждую неделю, с понедельника, — заново. Место — по выученным словам: тем, что вы вспомнили на повторении
          через день или позже. Сколько карточек пройдено, не важно. При равенстве выше тот, у кого больше дней занятий.
        </p>
      </Dialog>
      {person && <MemberWindow row={person} groupId={group.id} onClose={() => setPerson(null)} />}
    </div>
  );
}

/** What passing the member ahead takes: words to learn, or, with as many words, a tie-break. */
const MEASURE: Record<Measure, (n: number) => string> = {
  learned: (n) => `ещё ${wordsOf(n)}`,
  days: (n) => `ещё ${daysOf(n)} занятий`,
  streak: (n) => `ещё ${n}\u00a0${weeksWord(n)} подряд с выполненным обещанием`,
};

/** Where I am this week, and the one step that would move me up. */
function YourWeek({ standing }: { standing: Standing }) {
  if (standing.kind === 'unranked') {
    return (
      <div className={styles.place}>
        <p className={styles.placeTitle}>Вы ещё не занимались на этой неделе</p>
        <p className={styles.placeNote}>Один урок — и вы в рейтинге.</p>
      </div>
    );
  }
  if (standing.kind === 'top') {
    const note = standing.next
      ? standing.next.behind > 0
        ? `${standing.next.nickname} — в ${wordsOf(standing.next.behind)} позади.`
        : `${standing.next.nickname} — совсем рядом.`
      : null;
    return (
      <div className={styles.place} data-top="">
        <p className={styles.placeTitle}>
          Вы на 1-м месте{standing.shared.length > 0 && `, как и ${standing.shared.join(', ')}`}
        </p>
        {note && <p className={styles.placeNote}>{note}</p>}
      </div>
    );
  }
  return (
    <div className={styles.place}>
      <p className={styles.placeTitle}>Вы на {standing.rank}-м месте</p>
      <p className={styles.placeNote}>
        До {standing.aheadRank}-го — {MEASURE[standing.measure](standing.need)}.
      </p>
    </div>
  );
}

/**
 * A deck due for the class. A member: their own status and the way to study it. The teacher: how
 * many keep up, and by name only those who don't.
 */
function ForClass(props: { assignment: Assignment; board: Board; owner: boolean; onStudy: () => void }) {
  const { assignment, board, owner, onStudy } = props;
  const due = `к ${dueLabel(assignment.due_on!)}`;
  if (owner && assignment.members) {
    const me = board.rows.find((row) => row.is_me)?.member_id;
    const names = new Map(board.rows.map((row) => [row.member_id, row.nickname]));
    const students = assignment.members.filter((member) => member.member_id !== me && member.standing);
    const late = students.filter((member) => member.standing!.behind > 0);
    return (
      <li className={styles.classItem}>
        <p>
          <strong>{assignment.title}</strong> {due}: успевают {students.length - late.length} из {students.length}
        </p>
        {late.length > 0 && (
          <ul className={styles.late} aria-label={`Не успевают: «${assignment.title}»`}>
            {late.map((member) => (
              <li key={member.member_id}>
                {names.get(member.member_id)} — {standingLabel(member.standing!)}
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  }
  const mine = assignment.my_standing;
  return (
    <li className={styles.classItem}>
      <p>
        <strong>{assignment.title}</strong> {due}
        {mine && (
          <span className={styles.standing} data-behind={mine.behind > 0 || undefined} data-status={mine.status}>
            {' '}
            · {standingLabel(mine, true)}
          </span>
        )}
      </p>
      {mine?.status !== 'done' && (
        <button type="button" className={shared.smallButton} onClick={onStudy}>
          Учить
        </button>
      )}
    </li>
  );
}

/** The week's league: one number a person, ✓ for who studied today; a row opens their window. */
function League({ rows, onOpen }: { rows: BoardRow[]; onOpen: (row: BoardRow) => void }) {
  const placed = ranked(rows);
  const resting = rows.filter((row) => row.rank === null);
  return (
    <>
      {placed.length === 0 ? (
        <p className={styles.empty}>На этой неделе ещё никто не занимался. Начните первым!</p>
      ) : (
        <ol className={styles.board}>
          {visibleLines(placed).map((line, index) =>
            line.kind === 'row' ? (
              <li key={line.row.member_id} data-me={line.row.is_me || undefined}>
                <button
                  type="button"
                  className={styles.row}
                  onClick={() => onOpen(line.row)}
                  aria-label={[
                    `${line.row.rank}-е место: ${line.row.nickname}${line.row.is_me ? ' (вы)' : ''}`,
                    line.row.studied_today && 'сегодня уже есть занятие',
                    wordsOf(line.row.learned),
                  ]
                    .filter(Boolean)
                    .join(', ')}
                >
                  <span className={styles.rank} data-top={line.row.rank! <= 3 ? line.row.rank! : undefined}>
                    {line.row.rank}
                  </span>
                  <span className={styles.nick}>
                    {line.row.nickname}
                    {line.row.is_me && <span className={styles.me}>вы</span>}
                    {line.row.studied_today && <CheckIcon className={styles.todayMark} aria-hidden="true" />}
                  </span>
                  <strong className={styles.value}>{wordsOf(line.row.learned)}</strong>
                </button>
              </li>
            ) : (
              <li key={`gap-${index}`} className={styles.gap}>
                … ещё {membersOf(line.hidden)}
              </li>
            ),
          )}
        </ol>
      )}
      {resting.length > 0 && (
        <p className={styles.resting}>
          Ещё не начинали: {resting.map((row) => `${row.nickname}${row.is_me ? ' (вы)' : ''}`).join(', ')}
        </p>
      )}
    </>
  );
}

/** A person's figures, out of the league's way: this week, weeks in a row, all time. */
function MemberWindow({ row, groupId, onClose }: { row: BoardRow; groupId: string; onClose: () => void }) {
  const [allTime, setAllTime] = useState<number | null>(null);
  useEffect(() => {
    api.board(groupId, 'all').then(
      (board) => setAllTime(board.rows.find((other) => other.member_id === row.member_id)?.learned ?? 0),
      () => setAllTime(null),
    );
  }, [groupId, row.member_id]);
  return (
    <Dialog open onClose={onClose} title={row.is_me ? `${row.nickname} (вы)` : row.nickname}>
      <dl className={styles.figures}>
        <div>
          <dt>выучено на этой неделе</dt>
          <dd>{wordsOf(row.learned)}</dd>
        </div>
        <div>
          <dt>дней занятий на этой неделе</dt>
          <dd>{number.format(row.days)}</dd>
        </div>
        <div>
          <dt>карточек на этой неделе</dt>
          <dd>{number.format(row.cards)}</dd>
        </div>
        <div>
          <dt>{weeksWord(row.streak_weeks)} подряд с выполненным обещанием</dt>
          <dd>{number.format(row.streak_weeks)}</dd>
        </div>
        <div>
          <dt>выучено за всё время</dt>
          <dd>{allTime === null ? '…' : wordsOf(allTime)}</dd>
        </div>
      </dl>
    </Dialog>
  );
}

/** The owner's list of members, to remove someone; asks once before removing. */
function Members({ board, onRemoved, onDone }: { board: Board; onRemoved: () => void; onDone: () => void }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const { run, busy, error } = useAsyncAction();
  const others = board.rows.filter((row) => !row.is_me);
  return (
    <section aria-labelledby="members-title" className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 id="members-title" className={styles.sectionTitle}>
          Участники
        </h2>
        <button type="button" className={shared.linkButton} onClick={onDone}>
          Готово
        </button>
      </div>
      <ul className={styles.members}>
        {others.map((row) => (
          <li key={row.member_id}>
            <span>{row.nickname}</span>
            {confirm === row.member_id ? (
              <span className={shared.confirm}>
                <button
                  type="button"
                  className={shared.dangerButton}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api.removeMember(board.group.id, row.member_id);
                      setConfirm(null);
                      onRemoved();
                    })
                  }
                >
                  Удалить из группы
                </button>
                <button type="button" className={shared.linkButton} onClick={() => setConfirm(null)} data-autofocus>
                  Отмена
                </button>
              </span>
            ) : (
              <button type="button" className={shared.linkButton} onClick={() => setConfirm(row.member_id)}>
                Удалить
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p className={shared.problem} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function Housekeeping(props: { board: Board; onRemoved: () => void; onLeft: () => void }) {
  const { group } = props.board;
  const [managing, setManaging] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const { run, busy, error } = useAsyncAction();
  return (
    <>
      {managing && <Members board={props.board} onRemoved={props.onRemoved} onDone={() => setManaging(false)} />}
      <div className={shared.manage}>
        {group.role === 'owner' && group.member_count > 1 && !managing && (
          <button type="button" className={shared.linkButton} onClick={() => setManaging(true)}>
            Участники ({group.member_count})
          </button>
        )}
        {leaving ? (
          <span className={shared.confirm}>
            Выйти из группы?
            <button
              type="button"
              className={shared.dangerButton}
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api.leaveGroup(group.id);
                  props.onLeft();
                })
              }
            >
              Да, выйти
            </button>
            <SecondaryButton type="button" className={shared.smallSecondary} onClick={() => setLeaving(false)}>
              Отмена
            </SecondaryButton>
          </span>
        ) : (
          <button type="button" className={shared.linkButton} onClick={() => setLeaving(true)}>
            Выйти из группы
          </button>
        )}
        {error && (
          <p className={shared.problem} role="alert">
            {error}
          </p>
        )}
      </div>
    </>
  );
}
