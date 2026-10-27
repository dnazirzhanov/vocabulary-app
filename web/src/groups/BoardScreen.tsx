import { useCallback, useEffect, useRef, useState } from 'react';
import { daysAfterOf, plural, weeksWord } from '../i18n/plural.ts';
import { api, describeError } from '../lib/api.ts';
import { serverNow } from '../lib/clock.ts';
import { visibleLines } from '../lib/board.ts';
import type { Board, BoardRow } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { BackIcon, FlameIcon, PersonPlusIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { SecondaryButton } from '../ui/SecondaryButton.tsx';
import { InviteDialog } from './InviteDialog.tsx';
import styles from './Groups.module.css';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const dayMonth = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' });
const localDate = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
};
const days = (n: number) => `${n}\u00a0${plural(n, { one: 'день', few: 'дня', many: 'дней' })}`;
const members = (n: number) => `${n}\u00a0${plural(n, { one: 'участник', few: 'участника', many: 'участников' })}`;

interface BoardScreenProps {
  groupId: string;
  /** Open the invitation straight away: the group has just been created. */
  inviteOnOpen?: boolean;
  onBack: () => void;
  onLeft: () => void;
}

/** This week in the group: places by days practised, a shared goal, and a button to invite friends. */
export function BoardScreen({ groupId, inviteOnOpen = false, onBack, onLeft }: BoardScreenProps) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);
  const [inviting, setInviting] = useState(inviteOnOpen);
  const [confirm, setConfirm] = useState<string | null>(null); // a member id, or 'leave'
  const { run, busy, error: actionError } = useAsyncAction();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(
    () => api.board(groupId).then(setBoard, (caught: unknown) => setError(describeError(caught))),
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
  const ranked = board.rows.filter((row) => row.rank !== null);
  const resting = board.rows.filter((row) => row.rank === null);
  const owner = group.role === 'owner';
  const goalShare = Math.min(1, board.goal.done / board.goal.target);
  // Where the plan should be by the end of today, so a Monday never looks like a failure.
  const elapsedDays = Math.min(
    7,
    Math.max(1, Math.round((serverNow().getTime() - localDate(board.week_start).getTime()) / 86_400_000) + 1),
  );
  const plannedShare = elapsedDays / 7;
  const plannedByToday = Math.round(board.goal.target * plannedShare);

  const rowView = (row: BoardRow) => (
    <li key={row.member_id} className={styles.boardRow} data-me={row.is_me || undefined}>
      <span className={styles.rank} data-top={row.rank !== null && row.rank <= 3 ? row.rank : undefined}>
        {row.rank}
      </span>
      <div className={styles.who}>
        <p className={styles.nick}>
          {row.nickname}
          {row.is_me && <span className={styles.meTag}>вы</span>}
          {row.streak_weeks >= 2 && (
            <span
              className={styles.streak}
              title={`Обещание держится ${row.streak_weeks} ${weeksWord(row.streak_weeks)} подряд`}
            >
              <FlameIcon aria-hidden="true" />
              {row.streak_weeks}
            </span>
          )}
        </p>
        <p className={styles.weekDots} aria-label={`План выполнен: ${days(row.plan_days)} на этой неделе`}>
          {row.week.map((met, index) => (
            <i key={index} data-on={met || undefined} title={WEEKDAYS[index]} aria-hidden="true" />
          ))}
        </p>
      </div>
      <div className={styles.score}>
        <strong>
          {row.plan_days} из {row.promised_days}&nbsp;{daysAfterOf(row.promised_days)}
        </strong>
      </div>
      {managing && owner && !row.is_me && (
        <RemoveButton
          confirming={confirm === row.member_id}
          busy={busy}
          onAsk={() => setConfirm(row.member_id)}
          onCancel={() => setConfirm(null)}
          onConfirm={() =>
            run(async () => {
              await api.removeMember(group.id, row.member_id);
              setConfirm(null);
              await load();
            })
          }
        />
      )}
    </li>
  );

  return (
    <div className={styles.screen}>
      <header className={styles.topbar}>
        <button type="button" className={styles.back} onClick={onBack}>
          <BackIcon aria-hidden="true" /> Назад
        </button>
      </header>
      <main className={styles.main}>
        <div className={styles.boardLayout}>
          <div className={styles.boardMain}>
            <div className={styles.boardHead}>
              <div className={styles.boardTitle}>
                <p className={styles.eyebrow}>Группа</p>
                <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
                  {group.name}
                </h1>
                <p className={styles.meta}>
                  {members(group.member_count)} · неделя {dayMonth.format(localDate(board.week_start))} –{' '}
                  {dayMonth.format(localDate(board.week_end))}
                </p>
              </div>
              <PrimaryButton type="button" className={styles.inviteButton} onClick={() => setInviting(true)}>
                <PersonPlusIcon aria-hidden="true" /> Пригласить друзей
              </PrimaryButton>
            </div>

            <section className={styles.goal} aria-labelledby="goal-title">
              <h2 id="goal-title" className={styles.goalTitle}>
                Вместе за неделю
              </h2>
              <p className={styles.goalValue}>
                <strong>{board.goal.done}</strong> из {board.goal.target} новых слов
              </p>
              <div
                className={styles.goalTrack}
                role="progressbar"
                aria-labelledby="goal-title"
                aria-valuemin={0}
                aria-valuemax={board.goal.target}
                aria-valuenow={board.goal.done}
              >
                <span style={{ width: `${goalShare * 100}%` }} />
                <i className={styles.goalPlanned} style={{ left: `${plannedShare * 100}%` }} aria-hidden="true" />
              </div>
              <p className={styles.goalNote}>
                По плану к концу сегодняшнего дня — {plannedByToday}. Считаются слова по плану, без лишних.
              </p>
            </section>

            <h2 className={styles.sectionTitle}>Эта неделя</h2>
            <p className={styles.hint}>Место — по тому, сколько обещанных дней выполнен свой план.</p>
            {ranked.length === 0 ? (
              <p className={styles.empty}>Пока никто не занимался на этой неделе. Начните первым!</p>
            ) : (
              <ol className={styles.board}>
                {visibleLines(ranked).map((line, index) =>
                  line.kind === 'row' ? (
                    rowView(line.row)
                  ) : (
                    <li key={`gap-${index}`} className={styles.gap}>
                      … ещё {members(line.hidden)}
                    </li>
                  ),
                )}
              </ol>
            )}
            {resting.length > 0 && (
              <>
                <h3 className={styles.restingTitle}>Ещё не начали на этой неделе</h3>
                <ul className={styles.board}>
                  {resting.map((row) => (
                    <li key={row.member_id} className={styles.restingRow}>
                      <span>
                        {row.nickname}
                        {row.is_me && <span className={styles.meTag}>вы</span>}
                      </span>
                      {managing && owner && !row.is_me && (
                        <RemoveButton
                          confirming={confirm === row.member_id}
                          busy={busy}
                          onAsk={() => setConfirm(row.member_id)}
                          onCancel={() => setConfirm(null)}
                          onConfirm={() =>
                            run(async () => {
                              await api.removeMember(group.id, row.member_id);
                              setConfirm(null);
                              await load();
                            })
                          }
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {actionError && (
              <p className={styles.problem} role="alert">
                {actionError}
              </p>
            )}
            <div className={styles.manage}>
              {owner && group.member_count > 1 && (
                <button type="button" className={styles.linkButton} onClick={() => setManaging(!managing)}>
                  {managing ? 'Готово' : 'Управлять участниками'}
                </button>
              )}
              {confirm === 'leave' ? (
                <span className={styles.confirm}>
                  Выйти из группы?
                  <button
                    type="button"
                    className={styles.dangerButton}
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api.leaveGroup(group.id);
                        onLeft();
                      })
                    }
                  >
                    Да, выйти
                  </button>
                  <SecondaryButton type="button" className={styles.smallSecondary} onClick={() => setConfirm(null)}>
                    Отмена
                  </SecondaryButton>
                </span>
              ) : (
                <button type="button" className={styles.linkButton} onClick={() => setConfirm('leave')}>
                  Выйти из группы
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
      <InviteDialog
        code={group.invite_code}
        groupName={group.name}
        open={inviting}
        onClose={() => setInviting(false)}
      />
    </div>
  );
}

function RemoveButton(props: {
  confirming: boolean;
  busy: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!props.confirming) {
    return (
      <button type="button" className={styles.linkButton} onClick={props.onAsk}>
        Удалить
      </button>
    );
  }
  return (
    <span className={styles.confirm}>
      <button type="button" className={styles.dangerButton} disabled={props.busy} onClick={props.onConfirm}>
        Удалить из группы
      </button>
      <button type="button" className={styles.linkButton} onClick={props.onCancel}>
        Отмена
      </button>
    </span>
  );
}
