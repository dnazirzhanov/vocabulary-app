import { useCallback, useEffect, useRef, useState } from 'react';
import { api, describeError } from '../lib/api.ts';
import { knownLine, missesText, promiseText, todayLists, wordsCaption, wordsProgress } from '../lib/promise.ts';
import { WordCount, WordStages } from '../progress/WordStages.tsx';
import type { Board, BoardRow, Group } from '../lib/types.ts';
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
import { t } from '../i18n/index.ts';

interface GroupScreenProps {
  groupId: string;
  /** Open the invitation straight away: the group has just been created. */
  inviteOnOpen?: boolean;
  /** The author opens their deck, given to this group, in the editor (ADR 0019). */
  onOpenDeck: (deckId: string) => void;
  /** A member opens a deck with a deadline to study it. */
  /** To the lesson on the home page. */
  onStudy: () => void;
  /** The group's spelling tests (ADR 0046). */
  onTests: () => void;
  onBack: () => void;
  onLeft: () => void;
}

/**
 * One group (ADR 0039): a promise and a report, not a ranking. Today's count by the promise and my
 * own status; then each member's week against what they promised
 * and the month's missed days. A person's window adds the words they know. Everything else is a tap
 * away: the rule in «Как это считается?», housekeeping folded at the bottom.
 */
export function GroupScreen({
  groupId,
  inviteOnOpen = false,
  onOpenDeck,
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
          {t.tryAgain}
        </PrimaryButton>
      </main>
    );
  }
  if (!board) {
    return (
      <main className="message-screen" aria-busy="true">
        <p>{t.loading}</p>
      </main>
    );
  }

  const { group } = board;
  const showFold =
    board.assignments.length > 0 || group.can.includes('give_decks') || group.can.includes('delete_group');
  const me = board.rows.find((row) => row.is_me);

  return (
    <div className={shared.screen}>
      <header className={shared.topbar}>
        <button type="button" className={shared.back} onClick={onBack}>
          <BackIcon aria-hidden="true" /> {t.friends}
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
                <strong>{t.tests}</strong>
                {board.latest_test && (
                  <small>
                    {t.passedOfStudents(board.latest_test.passed, board.latest_test.students, board.latest_test.title)}
                  </small>
                )}
              </span>
              <ForwardIcon aria-hidden="true" />
            </button>
          )}

          <section aria-labelledby="today-title" className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 id="today-title" className={styles.sectionTitle}>
                {t.todayByThePromise}
              </h2>
              <button type="button" className={shared.linkButton} onClick={() => setRules(true)}>
                {t.howIsThisCounted}
              </button>
            </div>
            <Today me={me} onStudy={onStudy} onPromise={() => setPromising(true)} />
            <Report rows={board.rows} onOpen={setPerson} />
          </section>

          {showFold && (
            <details className={styles.manage}>
              <summary>{t.groupSettings}</summary>
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
      <Dialog open={rules} onClose={() => setRules(false)} title={t.howThisIsCounted}>
        <p className={styles.dialogText}>{t.everyonePromisesToStudyOnThe}</p>
        <p className={styles.dialogText}>{t.theNumberOfMissesStartsOver}</p>
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
            <CheckIcon aria-hidden="true" /> {t.youDone}
          </p>
        )}
        {me.promise_today === 'pending' && (
          <>
            <p className={styles.mineState}>{t.youNotYet}</p>
            <button type="button" className={shared.smallButton} onClick={onStudy}>
              {t.studyNow}
            </button>
          </>
        )}
        {me.promise_today === 'off' && (
          <p className={styles.mineState}>{me.paused ? t.youReOnAPause : t.todayIsYourDayOff}</p>
        )}
      </div>
      <p className={styles.promiseLine}>
        {t.myPromise} <strong>{promiseText(me.promise_weekdays)}</strong>
        <button type="button" className={shared.linkButton} onClick={onPromise}>
          {t.edit}
        </button>
      </p>
    </div>
  );
}

/**
 * Who kept today's promise, as plain lists of names: those who did it, those who haven't yet, and
 * those with the day off. Each friend is a card like a deck's on «Прогресс» (ADR 0052): words met of
 * the group's deck, the bar and its stages, and the promised days missed this month; it opens their
 * window. The deck is named once, above the lists, not on every card.
 */
function Report({ rows, onOpen }: { rows: BoardRow[]; onOpen: (row: BoardRow) => void }) {
  const caption = wordsCaption(rows);
  return (
    <>
      {caption && <p className={styles.caption}>{caption}</p>}
      {todayLists(rows).map((list) => (
        <section key={list.state} aria-label={list.title} className={styles.names}>
          <h3 className={styles.namesTitle} data-state={list.state}>
            <StateMark state={list.state} />
            {list.title}:<span className={styles.namesCount}>{list.rows.length}</span>
          </h3>
          <ul className={styles.report}>
            {list.rows.map((row) => (
              <FriendCard key={row.member_id} row={row} onOpen={() => onOpen(row)} />
            ))}
          </ul>
        </section>
      ))}
      {rows.length === 1 && <p className={styles.empty}>{t.youReAloneInTheGroup}</p>}
    </>
  );
}

/** One friend, as a deck's card on «Прогресс»; without a deck to measure against, a plain line. */
function FriendCard({ row, onOpen }: { row: BoardRow; onOpen: () => void }) {
  const progress = wordsProgress(row);
  const line = progress ? null : knownLine(row);
  return (
    <li>
      <button type="button" className={styles.friend} data-me={row.is_me || undefined} onClick={onOpen}>
        <span className={styles.friendHead}>
          <span className={styles.nick}>
            {row.name}
            {row.is_me && <span className={styles.me}>{t.you}</span>}
          </span>
          {progress && <WordCount met={progress.met} total={progress.total} />}
        </span>
        {progress && <WordStages {...progress} />}
        {line && <span className={styles.words}>{line}</span>}
        <span className={styles.misses} data-none={row.month_misses === 0 || undefined}>
          {missesText(row.month_misses)}
        </span>
        <ForwardIcon className={styles.chevron} aria-hidden="true" />
      </button>
    </li>
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
    <Dialog open onClose={onClose} title={row.is_me ? t.youSuffix(row.name) : row.name}>
      <section aria-labelledby="schedule-title" className={styles.block}>
        <h3 id="schedule-title" className={styles.blockTitle}>
          {t.promisedDays}
        </h3>
        <DayDots states={row.week_states} />
      </section>
      <p className={styles.missed}>
        {t.daysMissedThisMonth} <strong>{row.month_misses}</strong>
      </p>
      <section aria-labelledby="words-title" className={styles.wordsBlock}>
        <h3 id="words-title" className={styles.blockTitle}>
          {t.words}
        </h3>
        {row.decks.length > 0 ? (
          row.decks.map((deck) => (
            <DeckBar
              key={deck.deck_id}
              title={deck.title}
              met={deck.met}
              learned={deck.learned}
              total={deck.word_count}
            />
          ))
        ) : row.known + row.learning > 0 ? (
          <DeckBar met={row.known + row.learning} learned={row.known} total={row.known + row.learning} />
        ) : (
          <p className={styles.legend}>{t.noWordsYet}</p>
        )}
      </section>
      <ManageMember group={group} row={row} onDone={onChanged} />
    </Dialog>
  );
}

/** A deck's words as on «Прогресс»; without a title, their words in all, with no total to show. */
function DeckBar(props: { title?: string; met: number; learned: number; total: number }) {
  const { title, met, learned, total } = props;
  return (
    <div className={styles.deckBar}>
      {title && (
        <p className={styles.deckHead}>
          <span className={styles.deckTitle}>{title}</span>
          <WordCount met={met} total={total} />
        </p>
      )}
      <WordStages met={met} learned={learned} total={total} />
    </div>
  );
}
