/**
 * When today doesn't work (ADR 0074): three ways to bend the plan instead of dropping it, each with
 * the day before and after, so the learner sees exactly what changes.
 *
 * - minimum: five minutes of the most important task, as soon as there is room;
 * - later: the whole plan from a later free time today;
 * - tomorrow: today off; tomorrow keeps its usual load (never doubled).
 */
import { nextFree, slotsFor, type Busy } from './slots.ts';

export const MINIMUM_MINUTES = 5;
/** «Later» means at least this much later than now. */
export const LATER_AFTER = 60;

export interface Planned {
  title: string;
  minutes: number;
}

export interface Line {
  title: string;
  at: number | null;
  minutes: number;
}

export interface Rescue {
  mode: 'minimum' | 'moved' | 'skip';
  /** The new start for «moved». */
  start: number | null;
  before: Line[];
  after: Line[];
}

/** The minimum version of a plan: its first task, cut to five minutes. */
export function minimumOf<T extends Planned>(tasks: readonly T[]): T[] {
  return tasks.length ? [{ ...tasks[0], minutes: Math.min(MINIMUM_MINUTES, tasks[0].minutes) }] : [];
}

export function rescueOptions(
  tasks: readonly Planned[],
  busy: readonly Busy[],
  now: number,
  studyStart: number | null,
): Rescue[] {
  const lines = (list: readonly Planned[], at: (number | null)[]): Line[] =>
    list.map((t, i) => ({ title: t.title, at: at[i], minutes: t.minutes }));
  const before = lines(tasks, slotsFor(tasks, busy, now, studyStart));
  const options: Rescue[] = [];

  const smallest = minimumOf(tasks);
  if (smallest.length) {
    const at = nextFree(busy, Math.ceil(now / 5) * 5, smallest[0].minutes);
    if (at !== null) options.push({ mode: 'minimum', start: at, before, after: lines(smallest, [at]) });
  }

  const total = tasks.reduce((sum, t) => sum + t.minutes, 0);
  const later = total ? nextFree(busy, Math.ceil((now + LATER_AFTER) / 15) * 15, total) : null;
  if (later !== null) {
    options.push({ mode: 'moved', start: later, before, after: lines(tasks, slotsFor(tasks, busy, later, null)) });
  }

  options.push({ mode: 'skip', start: null, before, after: [] });
  return options;
}
