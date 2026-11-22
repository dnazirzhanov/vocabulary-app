/**
 * When to do each of today's tasks (ADR 0071): one after another, from the promised study time if
 * it is still ahead and free, else from now; around the day's schedule with a little air on both
 * sides of each block; between 07:00 and 22:00. A task that no longer fits today gets no time.
 */

export interface Busy {
  start: number;
  end: number;
}

export const DAY_START = 7 * 60;
export const DAY_END = 22 * 60;
export const AIR = 10;

/** The first start at or after `from` where `minutes` fit before any block (with air) and the day's end. */
export function nextFree(
  busy: readonly Busy[],
  from: number,
  minutes: number,
  dayEnd: number = DAY_END,
): number | null {
  let start = Math.max(from, DAY_START);
  const sorted = [...busy].sort((a, b) => a.start - b.start);
  for (let moved = true; moved;) {
    moved = false;
    for (const b of sorted) {
      if (b.start - AIR < start + minutes && start < b.end + AIR) {
        start = b.end + AIR;
        moved = true;
      }
    }
  }
  return start + minutes <= dayEnd ? start : null;
}

/** Each task's start minute, in order, or null when it no longer fits today. */
export function slotsFor(
  tasks: readonly { minutes: number }[],
  busy: readonly Busy[],
  now: number,
  studyStart: number | null,
  dayEnd: number = DAY_END,
): (number | null)[] {
  // Round up to the next five minutes: «19:05», not «19:03».
  let from = Math.ceil(now / 5) * 5;
  if (studyStart !== null && studyStart > from) from = studyStart;
  return tasks.map((task) => {
    const start = nextFree(busy, from, task.minutes, dayEnd);
    if (start !== null) from = start + task.minutes;
    return start;
  });
}

/**
 * When the learner's study day ends (ADR 0080): the start of tonight's sleep block if they have
 * one, else 23:00. Not a fixed 22:00: an evening learner can still move a plan to 22:15.
 */
export function dayEndFor(blocks: readonly { start: number; kind?: string }[]): number {
  const bedtimes = blocks.filter((b) => b.kind === 'sleep' && b.start >= 12 * 60).map((b) => b.start);
  return bedtimes.length ? Math.min(...bedtimes) : 23 * 60;
}

/** Until when the learner is free from `now`: the next block's start, or the day's end. */
export function freeUntil(busy: readonly Busy[], now: number, dayEnd: number = DAY_END): number {
  const later = busy.filter((b) => b.start > now).map((b) => b.start);
  return later.length ? Math.min(...later) : dayEnd;
}

/** The block the learner is in right now, if any. */
export function busyNow<T extends Busy>(busy: readonly T[], now: number): T | null {
  return busy.find((b) => b.start <= now && now < b.end) ?? null;
}
