/**
 * The learner's days, as the server counts them (backend/app/services/scheduling.py). Moments are
 * milliseconds since the epoch; days are 'YYYY-MM-DD' in the learner's time zone.
 *
 * Two kinds of day, both the server's:
 * - the study day starts at 4 AM (as in Anki): it decides when reviews are due;
 * - the calendar day starts at midnight: it decides which day an answer counts for.
 */

const DAY = 86_400_000;
const DAY_STARTS_AT_HOUR = 4;

const formats = new Map<string, Intl.DateTimeFormat>();
function format(timeZone: string): Intl.DateTimeFormat {
  let found = formats.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formats.set(timeZone, found);
  }
  return found;
}

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The wall clock in `timeZone` at a moment. */
function wall(moment: number, timeZone: string): Wall {
  const parts = Object.fromEntries(
    format(timeZone)
      .formatToParts(new Date(moment))
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

const iso = (year: number, month: number, day: number) =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** A day plus `days` (negative allowed). */
export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const moved = new Date(Date.UTC(year, month - 1, date) + days * DAY);
  return iso(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/** Whole days from `from` to `to`. */
export function daysBetween(from: string, to: string): number {
  const at = (day: string) => {
    const [year, month, date] = day.split('-').map(Number);
    return Date.UTC(year, month - 1, date);
  };
  return Math.round((at(to) - at(from)) / DAY);
}

/** The calendar day (from midnight) at a moment: `local_date` on the server. */
export function localDate(moment: number, timeZone: string): string {
  const local = wall(moment, timeZone);
  return iso(local.year, local.month, local.day);
}

/**
 * The study day (from 4 AM) at a moment: `study_day` on the server, which takes four hours off
 * the local wall clock and keeps the date.
 */
export function studyDay(moment: number, timeZone: string): string {
  const local = wall(moment, timeZone);
  const date = iso(local.year, local.month, local.day);
  return local.hour < DAY_STARTS_AT_HOUR ? addDays(date, -1) : date;
}

/**
 * The moment a local wall time happens (Python's zoneinfo with fold=0): in a gap (clocks moved
 * forward) the offset from before the change; when a time repeats, its first occurrence.
 */
export function wallTime(day: string, hour: number, timeZone: string): number {
  const [year, month, date] = day.split('-').map(Number);
  const asUtc = Date.UTC(year, month - 1, date, hour);
  const offsetAt = (moment: number) => {
    const local = wall(moment, timeZone);
    return (
      Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) -
      Math.floor(moment / 1000) * 1000
    );
  };
  // The offset just before this wall time is fold=0's choice; try it, then the one after.
  const before = offsetAt(asUtc - DAY);
  const after = offsetAt(asUtc + DAY);
  for (const offset of [before, after]) {
    const moment = asUtc - offset;
    const local = wall(moment, timeZone);
    if (local.hour === hour && iso(local.year, local.month, local.day) === day) return moment;
  }
  // A gap: the wall time never happens; fold=0 reads it with the offset from before.
  return asUtc - before;
}

/** The start of a study day: 4 AM local (`day_start` on the server). */
export function dayStart(day: string, timeZone: string): number {
  return wallTime(day, DAY_STARTS_AT_HOUR, timeZone);
}

/** The calendar day's bounds: midnight to midnight (`local_day_bounds` on the server). */
export function localDayBounds(day: string, timeZone: string): [number, number] {
  return [wallTime(day, 0, timeZone), wallTime(addDays(day, 1), 0, timeZone)];
}
