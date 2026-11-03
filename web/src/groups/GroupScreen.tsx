import { useCallback, useEffect, useRef, useState } from 'react';
import { weeksWord } from '../i18n/plural.ts';
import { api, describeError } from '../lib/api.ts';
import { dueLabel, standingLabel } from '../lib/deadline.ts';
import { dotsLabel, missesText, promiseText } from '../lib/promise.ts';
import type { Assignment, Board, BoardRow } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { DayDots, DayNames } from '../promise/DayDots.tsx';
import { PromiseDialog } from '../promise/PromiseDialog.tsx';
import { BackIcon, CheckIcon, PersonPlusIcon } from '../ui/icons.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { SecondaryButton } from '../ui/SecondaryButton.tsx';
import { GroupDecks } from '../decks/GroupDecks.tsx';
import { InviteDialog } from './InviteDialog.tsx';
import shared from './Groups.module.css';
import styles from './Group.module.css';

const number = new Intl.NumberFormat('ru');
const month = new Intl.DateTimeFormat('ru', { month: 'long', timeZone: 'UTC' });
const monthOf = (day: string) => month.format(Date.parse(`${day}T00:00:00Z`));

interface GroupScreenProps {
  groupId: string;
  /** Open the invitation straight away: the group has just been created. */
  inviteOnOpen?: boolean;
  /** The author opens their deck, given to this group, in the editor (ADR 0019). */
  onOpenDeck: (deckId: string) => void;
  /** A member opens a deck with a deadline to study it. */
  onStudyDeck: (deckId: string) => void;
  /** To the lesson on the home page. */
  onStudy: () => void;
  onBack: () => void;
  onLeft: () => void;
}

/**
 * One group (ADR 0039): a promise and a report, not a ranking. Today's count by the promise and my
 * own status; «К уроку» when a deadline is set; then each member's week against what they promised
 * and the month's missed days. A person's window adds the words they know. Everything else is a tap
 * away: the rule in «Как это считается?», housekeeping folded at the bottom.
 */
export function GroupScreen({
  groupId,
  inviteOnOpen = false,
  onOpenDeck,
  onStudyDeck,
  onStudy,
  onBack,
  onLeft,
}: GroupScreenProps) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(inviteOnOpen);
  const [person, setPerson] = useState<BoardRow | null>(null);
  const [rules, setRules] = useState(false);
  const [promising, setPromising] = useState(false);
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
  const me = board.rows.find((row) => row.is_me);

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

          <Today board={board} me={me} onStudy={onStudy} onPromise={() => setPromising(true)} />

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

          <section aria-labelledby="report-title" className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 id="report-title" className={styles.sectionTitle}>
                Отчёт · {monthOf(board.today)}
              </h2>
              <button type="button" className={shared.linkButton} onClick={() => setRules(true)}>
                Как это считается?
              </button>
            </div>
            <Report rows={board.rows} onOpen={setPerson} />
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
      <Dialog open={rules} onClose={() => setRules(false)} title="Как это считается">
        <p className={styles.dialogText}>
          Каждый обещает заниматься в выбранные дни недели. День засчитан, если закончен хотя бы один урок. Пропуск —
          день по обещанию, который кончился без урока. Изменение обещания начинается с завтра, на паузе пропусков нет.
        </p>
        <p className={styles.dialogText}>
          Число пропусков начинается заново первого числа каждого месяца. Дни считаются по времени группы. Мест и очков
          нет: важно только, держит ли каждый своё слово.
        </p>
      </Dialog>
      {person && <MemberWindow row={person} onClose={() => setPerson(null)} />}
      {promising && (
        <PromiseDialog
          onClose={() => {
            setPromising(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

/** Today by the promise: how many of the group did it, and where I stand. */
function Today(props: { board: Board; me: BoardRow | undefined; onStudy: () => void; onPromise: () => void }) {
  const { board, me, onStudy, onPromise } = props;
  const mine = me?.promise_today;
  return (
    <section aria-labelledby="today-title" className={styles.today}>
      <h2 id="today-title" className={styles.todayTitle}>
        Сегодня по обещанию
      </h2>
      {board.today_promised > 0 ? (
        <p className={styles.todayCount}>
          <strong>{board.today_done}</strong> из {board.today_promised}
        </p>
      ) : (
        <p className={styles.todayNote}>Сегодня ни у кого нет занятия по обещанию.</p>
      )}
      <div className={styles.mine}>
        {mine === 'done' && (
          <p className={styles.mineState} data-done="">
            <CheckIcon aria-hidden="true" /> Вы: сделано
          </p>
        )}
        {mine === 'pending' && (
          <>
            <p className={styles.mineState}>Вы: ещё нет</p>
            <button type="button" className={shared.smallButton} onClick={onStudy}>
              Заниматься
            </button>
          </>
        )}
        {mine === 'off' && <p className={styles.mineState}>{me?.paused ? 'Вы на паузе' : 'Сегодня у вас выходной'}</p>}
      </div>
      {me && (
        <p className={styles.promiseLine}>
          Моё обещание: <strong>{promiseText(me.promise_weekdays)}</strong>
          <button type="button" className={shared.linkButton} onClick={onPromise}>
            Изменить
          </button>
        </p>
      )}
    </section>
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

/** Each member's week against what they promised, and the month's missed days; a row opens their window. */
function Report({ rows, onOpen }: { rows: BoardRow[]; onOpen: (row: BoardRow) => void }) {
  return (
    <>
      <div className={styles.dayNames}>
        <DayNames />
      </div>
      <ul className={styles.report}>
        {rows.map((row) => (
          <li key={row.member_id} data-me={row.is_me || undefined}>
            <button
              type="button"
              className={styles.row}
              onClick={() => onOpen(row)}
              aria-label={`${row.nickname}${row.is_me ? ' (вы)' : ''}: ${missesText(row.month_misses)}. ${dotsLabel(row.week_states)}`}
            >
              <span className={styles.nick}>
                {row.nickname}
                {row.is_me && <span className={styles.me}>вы</span>}
              </span>
              <span className={styles.misses} data-none={row.month_misses === 0 || undefined}>
                {missesText(row.month_misses)}
              </span>
              <DayDots states={row.week_states} />
            </button>
          </li>
        ))}
      </ul>
      {rows.length === 1 && <p className={styles.empty}>Пока вы одни в группе. Пригласите друзей кнопкой вверху.</p>}
    </>
  );
}

/** A person's window: their promise, the month, and the words they know apart from it. */
function MemberWindow({ row, onClose }: { row: BoardRow; onClose: () => void }) {
  const met = row.known + row.learning;
  const share = (part: number) => `${met ? (part / met) * 100 : 0}%`;
  return (
    <Dialog open onClose={onClose} title={row.is_me ? `${row.nickname} (вы)` : row.nickname}>
      <DayDots states={row.week_states} named />
      <dl className={styles.figures}>
        <div>
          <dt>обещание</dt>
          <dd>{row.paused ? 'пауза' : promiseText(row.promise_weekdays)}</dd>
        </div>
        <div>
          <dt>пропусков в этом месяце</dt>
          <dd>{number.format(row.month_misses)}</dd>
        </div>
        <div>
          <dt>{weeksWord(row.streak_weeks)} подряд без пропусков</dt>
          <dd>{number.format(row.streak_weeks)}</dd>
        </div>
      </dl>
      <section aria-labelledby="words-title" className={styles.words}>
        <h3 id="words-title" className={styles.wordsTitle}>
          Слова
        </h3>
        {met > 0 ? (
          <>
            <div className={styles.bar} role="img" aria-label={`знаю ${row.known}, учу ${row.learning}`}>
              <i className={styles.barLearning} style={{ width: share(met) }} />
              <i className={styles.barKnown} style={{ width: share(row.known) }} />
            </div>
            <p className={styles.legend}>
              знаю {number.format(row.known)} · учу {number.format(row.learning)}
            </p>
          </>
        ) : (
          <p className={styles.legend}>Слов пока нет.</p>
        )}
      </section>
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
