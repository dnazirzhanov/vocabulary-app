import type { PlanDay } from './types.ts';

/**
 * Consistency, as the progress screen shows it: a calendar of days and the week against the days
 * promised. A day counts when the learner's own plan was done (ADR 0015, the same rule as the
 * friends board); a day with some learning is shown lightly, never as a miss. Dates are the
 * learner's local days as the server reports them ("2026-11-02"): plain calendar arithmetic.
 */

/** 0: nothing · 1: some learning, plan not done · 2: plan done. */
export type Level = 0 | 1 | 2;

export interface Cell {
  date: string;
  level: Level;
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
    return { date, level: levelOf(days.get(date)), future: date > today };
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

export interface Calendar {
  /** Oldest week first; each week is Monday to Sunday and the last one holds today. */
  weeks: Cell[][];
  /** Where a month begins: the index of its first week and its name. Sparse, so labels never touch. */
  months: { week: number; label: string }[];
  /** Days with the plan done in the whole calendar. */
  goalDays: number;
}

const MIN_WEEKS_BETWEEN_LABELS = 3;
const monthName = new Intl.DateTimeFormat('ru', { month: 'short', timeZone: 'UTC' });

export function buildCalendar(activity: PlanDay[], today: string, weekCount: number): Calendar {
  const first = addDays(mondayOf(today), -7 * (weekCount - 1));
  const cells = cellsFrom(first, 7 * weekCount, activity, today);
  const weeks = Array.from({ length: weekCount }, (_, week) => cells.slice(week * 7, week * 7 + 7));

  const months: Calendar['months'] = [];
  weeks.forEach((week, index) => {
    // A month is named over the week that contains its first day (not the first week at all:
    // the calendar starts mid-month).
    const start = week.find((cell) => cell.date.endsWith('-01'));
    if (!start) return;
    const last = months.at(-1);
    if (last && index - last.week < MIN_WEEKS_BETWEEN_LABELS) return;
    months.push({ week: index, label: monthName.format(toTime(start.date)).replace('.', '') });
  });

  return { weeks, months, goalDays: cells.filter((cell) => cell.level === 2).length };
}
