/**
 * What kind of day today is (ADR 0076) sets how much the plan asks:
 * an ordinary study day or a weekend asks the plan; a light day about half of it, the most
 * important first; an exam day only the five-minute minimum; a sick day nothing at all.
 * The plan's order is its priority, so whatever is cut is cut from the end.
 */
import { minimumOf, type Planned } from './rescue.ts';

export type DayType = 'study' | 'light' | 'weekend' | 'sick' | 'exam';
export const DAY_TYPES: DayType[] = ['study', 'light', 'weekend', 'exam', 'sick'];

/** Today's tasks for a kind of day; null (not said yet) is an ordinary day. */
export function loadFor<T extends Planned>(type: DayType | null, tasks: readonly T[]): T[] {
  switch (type) {
    case 'sick':
      return [];
    case 'exam':
      return minimumOf(tasks);
    case 'light': {
      const half = Math.ceil(tasks.reduce((sum, t) => sum + t.minutes, 0) / 2);
      const kept: T[] = [];
      let used = 0;
      for (const task of tasks) {
        if (kept.length && used + task.minutes > half) break;
        kept.push(task);
        used += task.minutes;
      }
      return kept;
    }
    default:
      return [...tasks];
  }
}
