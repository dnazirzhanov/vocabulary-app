import { useCallback, useEffect, useRef, useState } from 'react';
import { api, describeError } from '../lib/api.ts';
import { dueLabel, standingLabel } from '../lib/deadline.ts';
import {
  knownLine,
  missesText,
  promiseText,
  todayLists,
  wordsCaption,
  wordsLabel,
  wordsProgress,
} from '../lib/promise.ts';
import type { Assignment, Board, BoardRow, Group } from '../lib/types.ts';
import { DayDots, StateMark } from '../promise/DayDots.tsx';
import { PromiseDialog } from '../promise/PromiseDialog.tsx';
import { BackIcon, CheckIcon, ForwardIcon } from '../ui/icons.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { GroupDecks } from '../decks/GroupDecks.tsx';
import { DeleteGroup } from './DeleteGroup.tsx';
import { GroupTitle } from './GroupTitle.tsx';
import { InviteDialog } from './InviteDialog.tsx';
import { LeaveGroup } from './LeaveGroup.tsx';
import { ManageMember } from './ManageMember.tsx';
import shared from './Groups.module.css';
import styles from './Group.module.css';

const number = new Intl.NumberFormat('ru');

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
  /** The group's spelling tests (ADR 0046). */
  onTests: () => void;
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
  onTests,
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
  // Who sees everyone's standing under «К уроку» is a right of the role (ADR 0040).
  const owner = group.can.includes('see_standings');
  const showFold =
    board.assignments.length > 0 || group.can.includes('give_decks') || group.can.includes('delete_group');
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
          <GroupTitle
            group={group}
            headingRef={headingRef}
            onInvite={() => setInviting(true)}
            onRenamed={(renamed) => setBoard((current) => current && { ...current, group: renamed })}
          />

          {(board.has_tests || (board.assignments.length > 0 && group.can.includes('manage_tests'))) && (
            <button type="button" className={styles.testsRow} onClick={onTests}>
              <span>
                <strong>Тесты</strong>
                {board.latest_test && (
                  <small>
                    Сдали {board.latest_test.passed} из {board.latest_test.students} · {board.latest_test.title}
                  </small>
                )}
              </span>
              <ForwardIcon aria-hidden="true" />
            </button>
          )}

          <section aria-labelledby="today-title" className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 id="today-title" className={styles.sectionTitle}>
                Сегодня по обещанию
              </h2>
              <button type="button" className={shared.linkButton} onClick={() => setRules(true)}>
                Как это считается?
              </button>
            </div>
            <Today me={me} onStudy={onStudy} onPromise={() => setPromising(true)} />
            <Report rows={board.rows} onOpen={setPerson} />
          </section>

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

          {showFold && (
            <details className={styles.manage}>
              <summary>Управление группой</summary>
              <div className={styles.manageBody}>
                <GroupDecks board={board} onOpenDeck={onOpenDeck} onChanged={() => void load()} />
                <DeleteGroup group={group} onDeleted={onLeft} />
              </div>
            </details>
          )}
          <LeaveGroup board={board} onLeft={onLeft} />
        </div>
      </main>
      <InviteDialog
        code={group.invite_code}
        groupName={group.name}
        open={inviting}
        onClose={() => setInviting(false)}
        reset={
          group.can.includes('reset_invite')
            ? {
                groupId: group.id,
                onReset: (code) =>
                  setBoard((current) => current && { ...current, group: { ...current.group, invite_code: code } }),
              }
            : undefined
        }
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
      {person && (
        <MemberWindow
          row={person}
          group={group}
          onClose={() => setPerson(null)}
          onChanged={() => {
            setPerson(null);
            void load();
          }}
        />
      )}
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

/** Today by the promise, for me: whether I did it, and the weekdays I promised. */
function Today(props: { me: BoardRow | undefined; onStudy: () => void; onPromise: () => void }) {
  const { me, onStudy, onPromise } = props;
  if (!me) return null;
  return (
    <div className={styles.today}>
      <div className={styles.mine}>
        {me.promise_today === 'done' && (
          <p className={styles.mineState} data-done="">
            <CheckIcon aria-hidden="true" /> Вы: сделано
          </p>
        )}
        {me.promise_today === 'pending' && (
          <>
            <p className={styles.mineState}>Вы: ещё нет</p>
            <button type="button" className={shared.smallButton} onClick={onStudy}>
              Заниматься
            </button>
          </>
        )}
        {me.promise_today === 'off' && (
          <p className={styles.mineState}>{me.paused ? 'Вы на паузе' : 'Сегодня у вас выходной'}</p>
        )}
      </div>
      <p className={styles.promiseLine}>
        Моё обещание: <strong>{promiseText(me.promise_weekdays)}</strong>
        <button type="button" className={shared.linkButton} onClick={onPromise}>
          Изменить
        </button>
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

/**
 * Who kept today's promise, as plain lists of names: those who did it, those who haven't yet, and
 * those with the day off. Each friend shows how much of the group's deck they have learned, as a
 * bar in the language of «Прогресс» with its figure, and the promised days missed this month; a row
 * opens their window. The deck is named once, in a legend above the lists, not on every row.
 */
function Report({ rows, onOpen }: { rows: BoardRow[]; onOpen: (row: BoardRow) => void }) {
  const caption = wordsCaption(rows);
  return (
    <>
      {caption && (
        <p className={styles.legendRow}>
          <span>{caption}</span>
          <span className={styles.swatch} data-tone="known" aria-hidden="true" />
          <span>знаю</span>
          <span className={styles.swatch} data-tone="learning" aria-hidden="true" />
          <span>учу</span>
        </p>
      )}
      {todayLists(rows).map((list) => (
        <section key={list.state} aria-label={list.title} className={styles.names}>
          <h3 className={styles.namesTitle} data-state={list.state}>
            <StateMark state={list.state} />
            {list.title}:<span className={styles.namesCount}>{list.rows.length}</span>
          </h3>
          <ul className={styles.report}>
            {list.rows.map((row) => (
              <li key={row.member_id} data-me={row.is_me || undefined}>
                <button type="button" className={styles.row} onClick={() => onOpen(row)}>
                  <span className={styles.nick}>
                    {row.nickname}
                    {row.is_me && <span className={styles.me}>вы</span>}
                  </span>
                  <span className={styles.misses} data-none={row.month_misses === 0 || undefined}>
                    {missesText(row.month_misses)}
                  </span>
                  <RowWords row={row} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {rows.length === 1 && <p className={styles.empty}>Пока вы одни в группе. Пригласите друзей кнопкой вверху.</p>}
    </>
  );
}

/** One friend's words in the group's deck: a bar with its figure; without a deck, a plain line. */
function RowWords({ row }: { row: BoardRow }) {
  const progress = wordsProgress(row);
  if (!progress) {
    const line = knownLine(row);
    return line ? <span className={styles.words}>{line}</span> : null;
  }
  const share = (part: number) => `${(Math.min(part, progress.total) / progress.total) * 100}%`;
  return (
    <span className={styles.rowWords}>
      <span className={styles.rowBar} role="img" aria-label={wordsLabel(progress)}>
        <i className={styles.barLearning} style={{ width: share(progress.learned + progress.learning) }} />
        <i className={styles.barKnown} style={{ width: share(progress.learned) }} />
      </span>
      <strong className={styles.rowFigure} aria-hidden="true">
        {progress.learned} / {progress.total}
      </strong>
    </span>
  );
}

/**
 * A friend's window: «Обещанные дни», their week as the days-of-the-week dots (which show the
 * promised days),
 * the promised days missed this month, and for each deck how many words they know.
 */
function MemberWindow(props: { row: BoardRow; group: Group; onClose: () => void; onChanged: () => void }) {
  const { row, group, onClose, onChanged } = props;
  return (
    <Dialog open onClose={onClose} title={row.is_me ? `${row.nickname} (вы)` : row.nickname}>
      <section aria-labelledby="schedule-title" className={styles.block}>
        <h3 id="schedule-title" className={styles.blockTitle}>
          Обещанные дни
        </h3>
        <DayDots states={row.week_states} />
      </section>
      <p className={styles.missed}>
        Пропущено дней в этом месяце: <strong>{number.format(row.month_misses)}</strong>
      </p>
      <section aria-labelledby="words-title" className={styles.wordsBlock}>
        <h3 id="words-title" className={styles.blockTitle}>
          Слова
        </h3>
        {row.decks.length > 0 ? (
          row.decks.map((deck) => (
            <DeckBar
              key={deck.deck_id}
              title={deck.title}
              known={deck.learned}
              learning={deck.met - deck.learned}
              total={deck.word_count}
            />
          ))
        ) : row.known + row.learning > 0 ? (
          <DeckBar known={row.known} learning={row.learning} total={row.known + row.learning} />
        ) : (
          <p className={styles.legend}>Слов пока нет.</p>
        )}
      </section>
      <ManageMember group={group} row={row} onDone={onChanged} />
    </Dialog>
  );
}

/** «знаю · учу · впереди» as a two-tone bar over the deck's words, as on «Прогресс». */
function DeckBar(props: { title?: string; known: number; learning: number; total: number }) {
  const { title, known, learning, total } = props;
  const share = (part: number) => `${total ? Math.min(100, (part / total) * 100) : 0}%`;
  const ahead = Math.max(0, total - known - learning);
  const legend = [
    `знаю ${number.format(known)}`,
    `учу ${number.format(learning)}`,
    ahead > 0 && `впереди ${number.format(ahead)}`,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className={styles.deckBar}>
      {title && <p className={styles.deckTitle}>{title}</p>}
      <div className={styles.bar} role="img" aria-label={legend}>
        <i className={styles.barLearning} style={{ width: share(known + learning) }} />
        <i className={styles.barKnown} style={{ width: share(known) }} />
      </div>
      <p className={styles.legend}>{legend}</p>
    </div>
  );
}
