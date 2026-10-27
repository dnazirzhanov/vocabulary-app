import type { DayActivity } from './types.ts';

/**
 * Consistency, as the progress screen shows it: a calendar of days practised and a weekly
 * commitment. A day counts when the daily goal is met (the same rule as streaks and the friends
 * board); a day with less is shown lightly, never as a miss. Dates are the learner's local days as
 * the server reports them ("2026-11-02"), so everything here is plain calendar arithmetic.
 */

/** 0: nothing · 1: practised, below the goal · 2: goal met. */
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

export const levelOf = (points: number, goal: number): Level => (points >= goal ? 2 : points > 0 ? 1 : 0);

const pointsByDay = (activity: DayActivity[]) => new Map(activity.map((entry) => [entry.date, entry.points]));

function cellsFrom(first: string, count: number, activity: DayActivity[], goal: number, today: string): Cell[] {
  const points = pointsByDay(activity);
  return Array.from({ length: count }, (_, index) => {
    const date = addDays(first, index);
    return { date, level: levelOf(points.get(date) ?? 0, goal), future: date > today };
  });
}

export interface WeekProgress {
  /** Monday to Sunday. */
  days: Cell[];
  /** Days with the goal met so far this week. */
  done: number;
  target: number;
  /** The index of today in `days`. */
  todayIndex: number;
}

export function weekProgress(activity: DayActivity[], goal: number, today: string, target: number): WeekProgress {
  const days = cellsFrom(mondayOf(today), 7, activity, goal, today);
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
  /** Days with the goal met in the whole calendar. */
  goalDays: number;
}

const MIN_WEEKS_BETWEEN_LABELS = 3;
const monthName = new Intl.DateTimeFormat('ru', { month: 'short', timeZone: 'UTC' });

export function buildCalendar(activity: DayActivity[], goal: number, today: string, weekCount: number): Calendar {
  const first = addDays(mondayOf(today), -7 * (weekCount - 1));
  const cells = cellsFrom(first, 7 * weekCount, activity, goal, today);
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
