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
}

export interface ScheduleEventInput {
  title: string;
  kind: EventKind;
  weekdays: number;
  startMinute: number;
  endMinute: number;
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
