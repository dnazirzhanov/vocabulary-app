import type { BoardRow, DayState, TodayState } from './types.ts';

/**
 * The promise in words (ADR 0039): which weekdays a learner promised to study, and how the report
 * names a day. Weekdays are 0 (Monday) to 6 (Sunday).
 */
export const WEEKDAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** «каждый день», «Пн–Пт», «Пн Ср Пт», «Пн–Ср Пт»: runs of three or more days are collapsed. */
export function promiseText(weekdays: number[]): string {
  const days = [...new Set(weekdays)].sort((a, b) => a - b);
  if (days.length === 7) return 'каждый день';
  const parts: string[] = [];
  let index = 0;
  while (index < days.length) {
    let end = index;
    while (end + 1 < days.length && days[end + 1] === days[end] + 1) end += 1;
    if (end - index >= 2) parts.push(`${WEEKDAY_NAMES[days[index]]}–${WEEKDAY_NAMES[days[end]]}`);
    else for (let at = index; at <= end; at += 1) parts.push(WEEKDAY_NAMES[days[at]]);
    index = end + 1;
  }
  return parts.join(' ');
}

/** The weekdays promised in a week, from the seven yes/no flags of «Прогресс». */
export const weekdaysOf = (flags: boolean[]): number[] =>
  flags.flatMap((promised, weekday) => (promised ? [weekday] : []));

export const PROMISE_PRESETS: { label: string; weekdays: number[] }[] = [
  { label: 'Каждый день', weekdays: [0, 1, 2, 3, 4, 5, 6] },
  { label: 'Пн–Пт', weekdays: [0, 1, 2, 3, 4] },
];

/** A day of the report, for screen readers (the dots are drawn, not written). */
export const DAY_STATE_TEXT: Record<DayState, string> = {
  done: 'сделано',
  missed: 'пропущено',
  today: 'сегодня, ещё нет',
  later: 'впереди',
  off: 'не по обещанию',
};

export const dotsLabel = (states: DayState[]) =>
  `Неделя: ${states.map((state, weekday) => `${WEEKDAY_NAMES[weekday]} — ${DAY_STATE_TEXT[state]}`).join(', ')}`;

/** «пропусков: 2» for a member's month. */
export const missesText = (n: number) => `пропусков: ${n}`;

/** A calendar day (YYYY-MM-DD) some days later. */
export const plusDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export const sameDays = (a: number[], b: number[]) =>
  a.length === b.length && [...a].sort().every((weekday, index) => weekday === [...b].sort()[index]);

/** Today's report as names (ADR 0039): who did the promise, who hasn't yet, who has the day off. */
export interface TodayList {
  state: TodayState;
  title: string;
  rows: BoardRow[];
}

const TODAY_TITLES: Record<TodayState, string> = {
  done: 'Сделали сегодня',
  pending: 'Ещё нет',
  off: 'Сегодня выходной',
};

/** The rows keep the board's order (me, then alphabetical); a list with nobody in it is left out. */
export const todayLists = (rows: BoardRow[]): TodayList[] =>
  (['done', 'pending', 'off'] as const)
    .map((state) => ({ state, title: TODAY_TITLES[state], rows: rows.filter((row) => row.promise_today === state) }))
    .filter((list) => list.rows.length > 0);

/**
 * What a friend has learned from the deck given to the group: «Unit 4: выучено 12 из 30». With
 * several decks, the total; with none, the words they know in all (empty when there are none).
 */
export function wordsLine(row: BoardRow): string {
  const { decks } = row;
  if (decks.length === 0) return row.known > 0 ? `выучено слов: ${row.known}` : '';
  if (decks.length === 1) return `${decks[0].title}: выучено ${decks[0].learned} из ${decks[0].word_count}`;
  const learned = decks.reduce((sum, deck) => sum + deck.learned, 0);
  const total = decks.reduce((sum, deck) => sum + deck.word_count, 0);
  return `Выучено ${learned} из ${total} слов в колодах группы`;
}
