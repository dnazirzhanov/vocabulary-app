export type EventKind = 'school' | 'work' | 'sport' | 'chore' | 'personal' | 'other';

export interface ScheduleEvent {
  id: string;
  title: string;
  kind: EventKind;
  /** Weekdays bitmask: Monday = bit 1, Sunday = bit 64. Matches backend. */
  weekdays: number;
  /** Minutes from midnight in local time; startMinute < endMinute, endMinute ≤ 1440. */
  startMinute: number;
  endMinute: number;
  /** A block on this date only (YYYY-MM-DD), ADR 0074; null for a repeating one. */
  onDate: string | null;
  /** Dates a repeating block isn't happening. */
  skipped: string[];
}

export interface ScheduleEventInput {
  title: string;
  kind: EventKind;
  weekdays: number;
  startMinute: number;
  endMinute: number;
  onDate?: string | null;
}

/** A date as the server writes it: YYYY-MM-DD in the learner's own calendar. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whether a block is on a date: a one-off on its date; a repeating one on its weekdays, unless skipped. */
export function happensOn(event: ScheduleEvent, d: Date): boolean {
  const day = isoDay(d);
  if (event.onDate) return event.onDate === day;
  return Boolean(event.weekdays & (1 << ((d.getDay() + 6) % 7))) && !event.skipped.includes(day);
}

export const EVENT_KINDS: EventKind[] = ['school', 'work', 'sport', 'chore', 'personal', 'other'];

/** Pack a list of weekday indices (0 = Mon … 6 = Sun) into a bitmask. */
export function daysToMask(days: readonly number[]): number {
  return days.reduce((mask, day) => mask | (1 << day), 0);
}

/** Unpack a bitmask into a sorted list of weekday indices. */
export function maskToDays(mask: number): number[] {
  const days: number[] = [];
  for (let day = 0; day < 7; day += 1) if (mask & (1 << day)) days.push(day);
  return days;
}
