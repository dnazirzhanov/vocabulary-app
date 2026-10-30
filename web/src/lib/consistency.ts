import type { StudyDay } from './types.ts';

/**
 * Consistency, as the progress screen shows it: a calendar of days and the week against the days
 * promised. A day counts when a session of any kind was finished (ADR 0027, the same rule as the
 * friends board); a day with only some answers is shown lightly, never as a miss. Dates are the
 * learner's local days as the server reports them ("2026-11-02"): plain calendar arithmetic.
 */

/** 0: nothing · 1: some answers, nothing finished · 2: a session finished: the day counts. */
export type Level = 0 | 1 | 2;

/** The calendar's shade: 0 no cards, 1–4 more cards, relative to the learner's own busy days. */
export type Shade = 0 | 1 | 2 | 3 | 4;

export interface Cell {
  date: string;
  level: Level;
  cards: number;
  /** Later than today: drawn empty, never as a miss. */
  future: boolean;
}

const DAY_MS = 86_400_000;
const toTime = (day: string) => Date.parse(`${day}T00:00:00Z`);
const toDay = (time: number) => new Date(time).toISOString().slice(0, 10);
const addDays = (day: string, days: number) => toDay(toTime(day) + days * DAY_MS);
/** 0 for Monday … 6 for Sunday: weeks run Monday to Sunday, as on the friends board. */
const weekdayIndex = (day: string) => (new Date(toTime(day)).getUTCDay() + 6) % 7;
const mondayOf = (day: string) => addDays(day, -weekdayIndex(day));

export const levelOf = (day: StudyDay | undefined): Level => (day?.studied ? 2 : day?.active ? 1 : 0);

const byDate = (activity: StudyDay[]) => new Map(activity.map((day) => [day.date, day]));

function cellsFrom(first: string, count: number, activity: StudyDay[], today: string): Cell[] {
  const days = byDate(activity);
  return Array.from({ length: count }, (_, index) => {
    const date = addDays(first, index);
    const day = days.get(date);
    return { date, level: levelOf(day), cards: day?.cards ?? 0, future: date > today };
  });
}

export interface WeekProgress {
  /** Monday to Sunday. */
  days: Cell[];
  /** Days studied so far this week. */
  done: number;
  target: number;
  /** The index of today in `days`. */
  todayIndex: number;
}

export function weekProgress(activity: StudyDay[], today: string, target: number): WeekProgress {
  const days = cellsFrom(mondayOf(today), 7, activity, today);
  return {
    days,
    done: days.filter((day) => day.level === 2).length,
    target,
    todayIndex: weekdayIndex(today),
  };
}

export interface CalendarCell extends Cell {
  shade: Shade;
}

export interface MonthGrid {
  /** «январь» … «декабрь». */
  label: string;
  /** Blank places before the 1st, so the 1st falls under its weekday (weeks start on Monday). */
  offset: number;
  days: CalendarCell[];
}

export interface YearCalendar {
  year: number;
  /** January to December. */
  months: MonthGrid[];
  /** Days with any answers, days studied, and cards answered, over the year. */
  activeDays: number;
  studiedDays: number;
  cards: number;
}

const monthName = new Intl.DateTimeFormat('ru', { month: 'long', timeZone: 'UTC' });

/**
 * Shades relative to the learner's own busy days (the 90th percentile, so one marathon day does
 * not wash out the rest): a beginner's and a heavy learner's calendars both use the whole scale.
 */
export function shadeOf(cards: number, busy: number): Shade {
  if (cards <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((4 * cards) / Math.max(busy, 1)))) as Shade;
}

function busyDay(cells: Cell[]): number {
  const counts = cells
    .map((cell) => cell.cards)
    .filter((cards) => cards > 0)
    .sort((a, b) => a - b);
  return counts.length ? counts[Math.min(counts.length - 1, Math.floor(counts.length * 0.9))] : 1;
}

/** The years a learner can look at: from their first active day to this year. */
export function yearsOf(activity: StudyDay[], today: string): number[] {
  const last = Number(today.slice(0, 4));
  const first = Math.min(last, ...activity.map((day) => Number(day.date.slice(0, 4))));
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

/** A whole calendar year, January to December, as twelve month grids; days after today are empty. */
export function buildYear(activity: StudyDay[], today: string, year: number): YearCalendar {
  const first = `${year}-01-01`;
  const length = Math.round((toTime(`${year + 1}-01-01`) - toTime(first)) / DAY_MS);
  const plain = cellsFrom(first, length, activity, today);
  const busy = busyDay(plain);
  const cells = plain.map((cell) => ({ ...cell, shade: shadeOf(cell.cards, busy) }));
  const months = Array.from({ length: 12 }, (_, month) => {
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const days = cells.filter((cell) => cell.date.startsWith(prefix));
    return { label: monthName.format(toTime(days[0].date)), offset: weekdayIndex(days[0].date), days };
  });
  return {
    year,
    months,
    activeDays: cells.filter((cell) => cell.level > 0).length,
    studiedDays: cells.filter((cell) => cell.level === 2).length,
    cards: cells.reduce((sum, cell) => sum + cell.cards, 0),
  };
}
