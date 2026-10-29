import { useCallback, useEffect, useRef, useState } from 'react';
import { plural, weeksWord } from '../i18n/plural.ts';
import { api, describeError } from '../lib/api.ts';
import { rankedBy, standingOf, visibleLines, type Standing } from '../lib/board.ts';
import type { Board, BoardRow, Period, Ranking } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { BackIcon, CheckIcon, FlameIcon, PersonPlusIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { SecondaryButton } from '../ui/SecondaryButton.tsx';
import { GroupDecks } from '../decks/GroupDecks.tsx';
import { InviteDialog } from './InviteDialog.tsx';
import shared from './Groups.module.css';
import styles from './Group.module.css';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const number = new Intl.NumberFormat('ru');
const count = (n: number, one: string, few: string, many: string) =>
  `${number.format(n)}\u00a0${plural(n, { one, few, many })}`;
const daysOf = (n: number) => count(n, 'день', 'дня', 'дней');
const wordsOf = (n: number) => count(n, 'слово', 'слова', 'слов');
const cardsOf = (n: number) => count(n, 'карточка', 'карточки', 'карточек');
const membersOf = (n: number) => count(n, 'участник', 'участника', 'участников');

const PERIODS: { id: Period; label: string; during: string; whole: string }[] = [
  { id: 'week', label: 'Неделя', during: 'на этой неделе', whole: 'за неделю' },
  { id: 'month', label: 'Месяц', during: 'в этом месяце', whole: 'за месяц' },
  { id: 'all', label: 'Всё время', during: 'пока', whole: 'за всё время' },
];
const RANKINGS: { id: Ranking; label: string; rule: string }[] = [
  {
    id: 'steady',
    label: 'Регулярность',
    rule: 'Место — по дням занятий; при равенстве — по дням с выполненным планом, затем по неделям подряд.',
  },
  { id: 'learned', label: 'Выучено', rule: 'Слова, которые участник вспомнил на повторении — через день или позже.' },
  { id: 'cards', label: 'Карточки', rule: 'Все ответы: уроки, тренировки и правописание.' },
];
const periodOf = (id: Period) => PERIODS.find((period) => period.id === id)!;

/** A ranking's measure for one member, as the row's big figure. */
const headline = (row: BoardRow, ranking: Ranking) =>
  ranking === 'steady' ? daysOf(row.days) : ranking === 'learned' ? wordsOf(row.learned) : cardsOf(row.cards);

interface GroupScreenProps {
  groupId: string;
  /** Open the invitation straight away: the group has just been created. */
  inviteOnOpen?: boolean;
  /** A tap on a member opens their profile window (ADR 0015). */
  onOpenProfile: (memberId: string, nickname: string) => void;
  /** The author opens their deck, given to this group, in the editor (ADR 0019). */
  onOpenDeck: (deckId: string) => void;
  onBack: () => void;
  onLeft: () => void;
}

/**
 * One group (ADR 0023), answering in order: who has studied today; where I stand and what would
 * move me up; how everyone compares — over a week, a month or all time, by steadiness, words
 * learned or cards; how we are doing together; and the group's decks. Housekeeping comes last.
 */
export function GroupScreen({
  groupId,
  inviteOnOpen = false,
  onOpenProfile,
  onOpenDeck,
  onBack,
  onLeft,
}: GroupScreenProps) {
  const [boards, setBoards] = useState<Partial<Record<Period, Board>>>({});
  const [period, setPeriod] = useState<Period>('week');
  const [ranking, setRanking] = useState<Ranking>('steady');
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(inviteOnOpen);
  const [managing, setManaging] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(
    (which: Period) =>
      api.board(groupId, which).then(
        (board) => setBoards((known) => ({ ...known, [which]: board })),
        (caught: unknown) => setError(describeError(caught)),
      ),
    [groupId],
  );
  useEffect(() => {
    if (!boards[period]) void load(period);
  }, [boards, period, load]);
  // While another period loads, one already loaded stays on screen.
  const shown = boards[period] ?? boards.week ?? boards.month ?? boards.all ?? null;
  const focused = useRef(false);
  useEffect(() => {
    if (!shown || focused.current) return;
    focused.current = true;
    headingRef.current?.focus();
  }, [shown]);
  const reload = () => {
    setBoards({});
    return load(period);
  };

  if (error) {
    return (
      <main className="message-screen">
        <p role="alert">{error}</p>
        <PrimaryButton type="button" onClick={() => (setError(null), void reload())}>
          Повторить
        </PrimaryButton>
      </main>
    );
  }
  if (!shown) {
    return (
      <main className="message-screen" aria-busy="true">
        <p>Загружаем…</p>
      </main>
    );
  }

  const board = shown;
  const { group } = board;
  const loading = !boards[period];
  const when = periodOf(board.period);

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
            <div>
              <h1 ref={headingRef} tabIndex={-1} className={shared.title}>
                {group.name}
              </h1>
              <p className={styles.meta}>
                {membersOf(group.member_count)} · вы — {group.nickname}
              </p>
            </div>
            <button
              type="button"
              className={`${shared.smallButton} ${styles.invite}`}
              onClick={() => setInviting(true)}
            >
              <PersonPlusIcon aria-hidden="true" /> Пригласить
            </button>
          </div>

          <TodayStrip rows={board.rows} />

          <section aria-labelledby="rating-title" className={styles.section} aria-busy={loading || undefined}>
            <div className={styles.sectionHead}>
              <h2 id="rating-title" className={styles.sectionTitle}>
                Рейтинг
              </h2>
              <Segmented label="Период" options={PERIODS} value={period} onChange={setPeriod} />
            </div>
            <Segmented label="Рейтинг по" options={RANKINGS} value={ranking} onChange={setRanking} wide />
            <p className={styles.rule}>{RANKINGS.find((option) => option.id === ranking)!.rule}</p>
            <YourPlace standing={standingOf(board.rows, ranking)} ranking={ranking} board={board} />
            <Leaderboard
              rows={board.rows}
              ranking={ranking}
              period={board.period}
              onOpen={(row) => onOpenProfile(row.member_id, row.nickname)}
            />
          </section>

          <section aria-labelledby="together-title" className={styles.section}>
            <h2 id="together-title" className={styles.sectionTitle}>
              Вместе {when.whole}
            </h2>
            <dl className={styles.figures}>
              <div>
                <dt>{plural(board.totals.days, { one: 'день занятий', few: 'дня занятий', many: 'дней занятий' })}</dt>
                <dd>{number.format(board.totals.days)}</dd>
              </div>
              <div>
                <dt>
                  {plural(board.totals.learned, { one: 'слово выучено', few: 'слова выучено', many: 'слов выучено' })}
                </dt>
                <dd>{number.format(board.totals.learned)}</dd>
              </div>
              <div>
                <dt>{plural(board.totals.cards, { one: 'карточка', few: 'карточки', many: 'карточек' })}</dt>
                <dd>{number.format(board.totals.cards)}</dd>
              </div>
            </dl>
          </section>

          <GroupDecks board={board} onOpenDeck={onOpenDeck} />

          {managing && <Members board={board} onRemoved={() => void reload()} onDone={() => setManaging(false)} />}
          <Housekeeping board={board} managing={managing} onManage={() => setManaging(!managing)} onLeft={onLeft} />
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

/** A small set of mutually exclusive buttons: the period, or what the ranking goes by. */
function Segmented<T extends string>(props: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  wide?: boolean;
}) {
  return (
    <div className={styles.segmented} role="group" aria-label={props.label} data-wide={props.wide || undefined}>
      {props.options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={option.id === props.value}
          onClick={() => props.onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Who has studied today: the gentlest nudge — names, no numbers. */
function TodayStrip({ rows }: { rows: BoardRow[] }) {
  const sorted = [...rows].sort(
    (a, b) => Number(b.studied_today) - Number(a.studied_today) || Number(b.is_me) - Number(a.is_me),
  );
  const done = rows.filter((row) => row.studied_today).length;
  return (
    <section aria-labelledby="today-title" className={styles.today}>
      <h2 id="today-title" className={styles.todayTitle}>
        Сегодня занимались <strong>{done}</strong> из {rows.length}
      </h2>
      <ul className={styles.chips}>
        {sorted.map((row) => (
          <li key={row.member_id} data-on={row.studied_today || undefined}>
            {row.studied_today && <CheckIcon aria-hidden="true" />}
            {row.nickname}
            {row.is_me && <span className={styles.me}>вы</span>}
            <span className="visually-hidden">
              {row.studied_today ? ' — сегодня уже было занятие' : ' — сегодня ещё нет'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const MEASURE: Record<Exclude<Extract<Standing, { kind: 'chasing' }>['measure'], 'value'>, (n: number) => string> = {
  days: (n) => `${daysOf(n)} занятий`,
  plan_days: (n) => `${daysOf(n)} с выполненным планом`,
  streak: (n) => `${n}\u00a0${weeksWord(n)} подряд с выполненным обещанием`,
};

/** Where I stand in the chosen ranking, and what would move me up — or who is closest behind. */
function YourPlace({ standing, ranking, board }: { standing: Standing; ranking: Ranking; board: Board }) {
  const when = periodOf(board.period);
  if (standing.kind === 'unranked') {
    return (
      <div className={styles.place}>
        <p className={styles.placeTitle}>Вы ещё не занимались {when.during === 'пока' ? '' : when.during}</p>
        <p className={styles.placeNote}>Один урок — и вы в рейтинге.</p>
      </div>
    );
  }
  const amount = (n: number) => (ranking === 'learned' ? wordsOf(n) : ranking === 'cards' ? cardsOf(n) : daysOf(n));
  if (standing.kind === 'top') {
    const note = standing.next
      ? `Ближайший — ${standing.next.nickname}${
          standing.next.behind > 0 ? `, на ${amount(standing.next.behind)} позади` : ''
        }.`
      : standing.shared.length === 0
        ? 'Пока вы единственный в рейтинге.'
        : '';
    return (
      <div className={styles.place} data-top="">
        <p className={styles.placeTitle}>
          Вы на 1-м месте{standing.shared.length > 0 && ` вместе с ${standing.shared.join(', ')}`}
        </p>
        {note && <p className={styles.placeNote}>{note}</p>}
      </div>
    );
  }
  const what =
    standing.measure === 'value'
      ? ranking === 'learned'
        ? `${wordsOf(standing.need)} выучить`
        : `${cardsOf(standing.need)} ответить`
      : MEASURE[standing.measure](standing.need);
  // Days can't outnumber the days left in a week or month.
  const left = daysLeft(board);
  const tooLate =
    (standing.measure === 'days' || standing.measure === 'plan_days') && left !== null && standing.need > left;
  return (
    <div className={styles.place}>
      <p className={styles.placeTitle}>Вы на {standing.rank}-м месте</p>
      <p className={styles.placeNote}>
        {tooLate
          ? `До ${standing.aheadRank}-го места (${standing.ahead}) нужно ещё ${what} — ${when.whole.replace('за', 'до конца')} столько уже не успеть.`
          : `До ${standing.aheadRank}-го места (${standing.ahead}): ещё ${what}.`}
      </p>
    </div>
  );
}

/** Days still to come in a week or month, today included; null for all time. */
function daysLeft(board: Board): number | null {
  if (board.period === 'all') return null;
  const me = board.rows.find((row) => row.is_me);
  const end = Date.parse(`${board.period_end}T00:00:00Z`);
  const now = new Date();
  const start = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((end - start) / 86_400_000) + 1;
  return Math.max(0, days - (me?.studied_today ? 1 : 0));
}

function Leaderboard(props: { rows: BoardRow[]; ranking: Ranking; period: Period; onOpen: (row: BoardRow) => void }) {
  const { rows, ranking, period, onOpen } = props;
  const ranked = rankedBy(rows, ranking);
  const resting = rows.filter((row) => row.ranks[ranking] === null);
  const when = periodOf(period);
  return (
    <>
      {ranked.length === 0 ? (
        <p className={styles.empty}>
          Пока никто не занимался {when.during === 'пока' ? '' : when.during}. Начните первым!
        </p>
      ) : (
        <ol className={styles.board}>
          {visibleLines(ranked).map((line, index) =>
            line.kind === 'row' ? (
              <li key={line.row.member_id} data-me={line.row.is_me || undefined}>
                <RowButton row={line.row} ranking={ranking} period={period} onOpen={() => onOpen(line.row)} />
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
          <span>Ещё не занимались {when.during === 'пока' ? '' : when.during}:</span>{' '}
          {resting.map((row, index) => (
            <span key={row.member_id}>
              <button type="button" className={styles.restingName} onClick={() => onOpen(row)}>
                {row.nickname}
                {row.is_me && ' (вы)'}
              </button>
              {index < resting.length - 1 && ', '}
            </span>
          ))}
        </p>
      )}
    </>
  );
}

/** One member: place, name, the ranking's figure, and the other figures quietly beneath. */
function RowButton({
  row,
  ranking,
  period,
  onOpen,
}: {
  row: BoardRow;
  ranking: Ranking;
  period: Period;
  onOpen: () => void;
}) {
  const place = row.ranks[ranking]!;
  const others = [
    ranking !== 'steady' && `${daysOf(row.days)} занятий`,
    ranking === 'steady' && `план ${row.plan_days}`,
    ranking !== 'learned' && `выучено ${number.format(row.learned)}`,
    ranking !== 'cards' && cardsOf(row.cards),
  ].filter(Boolean);
  return (
    <button type="button" className={styles.row} onClick={onOpen}>
      <span className={styles.rank} data-top={place <= 3 ? place : undefined}>
        {place}
      </span>
      <span className={styles.who}>
        <span className={styles.nick}>
          {row.nickname}
          {row.is_me && <span className={styles.me}>вы</span>}
          {row.streak_weeks >= 2 && (
            <span
              className={styles.streak}
              title={`Обещание держится ${row.streak_weeks} ${weeksWord(row.streak_weeks)} подряд`}
            >
              <FlameIcon aria-hidden="true" />
              {row.streak_weeks}
            </span>
          )}
        </span>
        <span className={styles.stats}>{others.join(' · ')}</span>
        {ranking === 'steady' && period === 'week' && (
          <span
            className={styles.dots}
            role="img"
            aria-label={`План выполнен: ${daysOf(row.plan_days)} на этой неделе`}
          >
            {row.week.map((met, index) => (
              <i key={index} data-on={met || undefined} title={WEEKDAYS[index]} aria-hidden="true" />
            ))}
          </span>
        )}
      </span>
      <strong className={styles.value}>{headline(row, ranking)}</strong>
    </button>
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

function Housekeeping(props: { board: Board; managing: boolean; onManage: () => void; onLeft: () => void }) {
  const { group } = props.board;
  const [leaving, setLeaving] = useState(false);
  const { run, busy, error } = useAsyncAction();
  return (
    <div className={shared.manage}>
      {group.role === 'owner' && group.member_count > 1 && !props.managing && (
        <button type="button" className={shared.linkButton} onClick={props.onManage}>
          Управлять участниками
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
  );
}
