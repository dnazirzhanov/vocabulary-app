/**
 * Where a day's blocks go on the timeline (ADR 0073): blocks that overlap share the width side by
 * side, each in its own lane, instead of covering each other; the visible hours are 07–22 and
 * grow to fit anything earlier or later, so nothing is cut off. Pure, so it can be tested.
 */

export interface Span {
  start: number;
  end: number;
}

export interface Placed<T> {
  item: T;
  /** The block's lane, and how many lanes its group of overlapping blocks needs. */
  lane: number;
  lanes: number;
}

export const FIRST_HOUR = 7;
export const LAST_HOUR = 22;

/** Lanes for blocks that overlap: each takes the first lane free at its start. */
export function placeLanes<T extends Span>(items: readonly T[]): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const placed: Placed<T>[] = [];
  let group: Placed<T>[] = [];
  let groupEnd = -1;
  const close = () => {
    const lanes = Math.max(1, ...group.map((p) => p.lane + 1));
    for (const p of group) p.lanes = lanes;
    placed.push(...group);
    group = [];
  };
  for (const item of sorted) {
    if (group.length && item.start >= groupEnd) close();
    const busy = new Set(group.filter((p) => p.item.end > item.start).map((p) => p.lane));
    let lane = 0;
    while (busy.has(lane)) lane += 1;
    group.push({ item, lane, lanes: 1 });
    groupEnd = Math.max(groupEnd, item.end);
  }
  if (group.length) close();
  return placed;
}

/** The hours the day shows: 07–22, widened to whole hours around anything outside them. */
export function hourRange(spans: readonly Span[]): { first: number; last: number } {
  const first = Math.min(FIRST_HOUR, ...spans.map((s) => Math.floor(s.start / 60)));
  const last = Math.max(LAST_HOUR, ...spans.map((s) => Math.ceil(s.end / 60)));
  return { first, last: Math.min(24, last) };
}

/** Free stretches between blocks inside the visible hours, at least `min` minutes long. */
export function freeGaps(spans: readonly Span[], first: number, last: number, min = 30): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const gaps: Span[] = [];
  let at = first * 60;
  for (const s of sorted) {
    if (s.start - at >= min) gaps.push({ start: at, end: s.start });
    at = Math.max(at, s.end);
  }
  if (last * 60 - at >= min) gaps.push({ start: at, end: last * 60 });
  return gaps;
}

/** A minute rounded to the nearest quarter hour, kept within the day. */
export function snap(minute: number, step = 15): number {
  return Math.max(0, Math.min(24 * 60, Math.round(minute / step) * step));
}

/** The seven dates of the week holding `day`, Monday first. */
export function weekOf(day: Date): Date[] {
  const monday = new Date(day.getFullYear(), day.getMonth(), day.getDate() - ((day.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
}
