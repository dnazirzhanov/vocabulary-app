/**
 * When today doesn't go to plan (ADR 0080): bend the day, protect the week. Three honest choices:
 *
 * - minimum: five minutes of the most important task, at the planned time if it is still ahead,
 *   else as soon as there is room (never miss twice);
 * - another time: real free times today, before or after the plan, up to bedtime, for the whole
 *   plan (or the learner's own time);
 * - rest: nothing today. Words due wait for tomorrow and the week's targets spread over the days
 *   left, so no day is ever doubled.
 */
import { nextFree, type Busy } from './slots.ts';

export const MINIMUM_MINUTES = 5;
/** How many other times are offered. */
export const TIMES_OFFERED = 4;

export interface Planned {
  title: string;
  minutes: number;
}

/** What the learner chose; `start` for the minimum and for another time. */
export interface Rescue {
  mode: 'minimum' | 'moved' | 'skip';
  start: number | null;
}

export interface RescueChoices {
  minimum: { task: Planned; start: number } | null;
  /** Free starts for the whole plan, earliest first; the planned time itself is left out. */
  times: number[];
  /** How long the whole plan takes. */
  total: number;
}

/** The minimum version of a plan: its first task, cut to five minutes. */
export function minimumOf<T extends Planned>(tasks: readonly T[]): T[] {
  return tasks.length ? [{ ...tasks[0], minutes: Math.min(MINIMUM_MINUTES, tasks[0].minutes) }] : [];
}

const half = (minute: number) => Math.ceil(minute / 30) * 30;

/** Up to `count` items spread evenly over a list, first and last included. */
function spread<T>(list: readonly T[], count: number): T[] {
  if (list.length <= count) return [...list];
  return Array.from({ length: count }, (_, i) => list[Math.round((i * (list.length - 1)) / (count - 1))]);
}

export function rescueChoices(
  tasks: readonly Planned[],
  busy: readonly Busy[],
  now: number,
  planned: number | null,
  dayEnd: number,
): RescueChoices {
  const total = tasks.reduce((sum, t) => sum + t.minutes, 0);
  const soon = Math.ceil(now / 5) * 5;

  let minimum: RescueChoices['minimum'] = null;
  const [first] = minimumOf(tasks);
  if (first) {
    const from = planned !== null && planned > soon ? planned : soon;
    const start = nextFree(busy, from, first.minutes, dayEnd) ?? nextFree(busy, soon, first.minutes, dayEnd);
    if (start !== null) minimum = { task: first, start };
  }

  const free: number[] = [];
  if (total > 0) {
    for (let at = half(soon); at + total <= dayEnd; at += 30) {
      if (at !== planned && nextFree(busy, at, total, dayEnd) === at) free.push(at);
    }
  }
  return { minimum, times: spread(free, TIMES_OFFERED), total };
}
