import type { PlanDay } from './types.ts';

/**
 * Consistency, as the progress screen shows it: a calendar of days and the week against the days
 * promised. A day counts when the learner's own plan was done (ADR 0015, the same rule as the
 * friends board); a day with some learning is shown lightly, never as a miss. Dates are the
 * learner's local days as the server reports them ("2026-11-02"): plain calendar arithmetic.
 */

/** 0: nothing · 1: some learning, plan not done · 2: plan done. */
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

export const levelOf = (day: PlanDay | undefined): Level => (day?.plan_done ? 2 : day?.active ? 1 : 0);

const byDate = (activity: PlanDay[]) => new Map(activity.map((day) => [day.date, day]));

function cellsFrom(first: string, count: number, activity: PlanDay[], today: string): Cell[] {
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
  /** Days with the plan done so far this week. */
  done: number;
  target: number;
  /** The index of today in `days`. */
  todayIndex: number;
}

export function weekProgress(activity: PlanDay[], today: string, target: number): WeekProgress {
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

export interface Calendar {
  /** Oldest week first; each week is Monday to Sunday and the last one holds today. */
  weeks: CalendarCell[][];
  /** A month named over the first week that starts in it, spanning the weeks until the next one. */
  months: { week: number; span: number; label: string }[];
  /** Days with any learning, days with the plan done, and cards answered, over the calendar. */
  activeDays: number;
  goalDays: number;
  cards: number;
}

const monthName = new Intl.DateTimeFormat('ru', { month: 'short', timeZone: 'UTC' });
/** A label needs two weeks of room, so short names never run into the next one or off the edge. */
const MIN_LABEL_WEEKS = 2;

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

export function buildCalendar(activity: PlanDay[], today: string, weekCount: number): Calendar {
  const first = addDays(mondayOf(today), -7 * (weekCount - 1));
  const plain = cellsFrom(first, 7 * weekCount, activity, today);
  const busy = busyDay(plain);
  const cells = plain.map((cell) => ({ ...cell, shade: shadeOf(cell.cards, busy) }));
  const weeks = Array.from({ length: weekCount }, (_, week) => cells.slice(week * 7, week * 7 + 7));

  // A week belongs to the month of its Monday; a month is named where its weeks begin.
  const starts: { week: number; label: string }[] = [];
  weeks.forEach((week, index) => {
    const month = week[0].date.slice(0, 7);
    if (index > 0 && weeks[index - 1][0].date.slice(0, 7) === month) return;
    starts.push({ week: index, label: monthName.format(toTime(week[0].date)).replace('.', '') });
  });
  const months = starts
    .map((start, index) => ({ ...start, span: (starts[index + 1]?.week ?? weekCount) - start.week }))
    .filter((month) => month.span >= MIN_LABEL_WEEKS);

  return {
    weeks,
    months,
    activeDays: cells.filter((cell) => cell.level > 0).length,
    goalDays: cells.filter((cell) => cell.level === 2).length,
    cards: cells.reduce((sum, cell) => sum + cell.cards, 0),
  };
}
