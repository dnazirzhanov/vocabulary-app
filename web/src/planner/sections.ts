/** How «Планы» lays out the items: by day, overdue first, timed tasks by time, then priority. */
import type { Item } from './api.ts';
import { addDays } from './dates.ts';

/** Timed tasks first, earliest first; then higher priority; then by title. */
export function byTime(a: Item, b: Item): number {
  const ta = a.task.start_minute ?? 10_000;
  const tb = b.task.start_minute ?? 10_000;
  return ta - tb || b.task.priority - a.task.priority || a.task.title.localeCompare(b.task.title);
}

export interface DayView {
  overdue: Item[];
  open: Item[];
  done: Item[];
}

/** One day's list. Overdue one-offs show on today only; a skipped day of a repeat isn't shown. */
export function dayView(items: Item[], day: string, today: string): DayView {
  const overdue = day === today ? items.filter((i) => i.overdue && i.state === null).sort(byTime) : [];
  const onDay = items.filter((i) => i.on === day && !i.overdue);
  return {
    overdue,
    open: onDay.filter((i) => i.state === null).sort(byTime),
    done: onDay.filter((i) => i.state === 'done').sort(byTime),
  };
}

/** «Входящие»: tasks with no date, open ones first. */
export function inbox(items: Item[]): DayView {
  const none = items.filter((i) => i.on === null);
  return { overdue: [], open: none.filter((i) => i.state === null), done: none.filter((i) => i.state === 'done') };
}

/** «Предстоящие»: each of the next days with something still open on it. */
export function upcoming(items: Item[], today: string, days = 7): { day: string; items: Item[] }[] {
  return Array.from({ length: days }, (_, n) => addDays(today, n))
    .map((day) => ({ day, items: items.filter((i) => i.on === day && i.state === null && !i.overdue).sort(byTime) }))
    .filter((d) => d.items.length > 0);
}

/** How many open tasks each day has: the week strip's dots. */
export function openCount(items: Item[], day: string): number {
  return items.filter((i) => i.on === day && i.state === null && !i.overdue).length;
}

/** The same item, as one stands for a key (a repeat's occurrence is task + day). */
export const keyOf = (i: Item) => `${i.task.id}:${i.on ?? ''}`;
