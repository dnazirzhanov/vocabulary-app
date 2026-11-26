/** Calendar days as 'YYYY-MM-DD' strings: no time zone ever enters the sums. */

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday 0 … Sunday 6, as the server's weekday masks (Monday = 1 … Sunday = 64). */
export function weekday(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export const bitOf = (iso: string) => 1 << weekday(iso);

/** The device's own calendar day. */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Where a repeat starts: the first of its days from the date the person chose (ADR 0093). Always
 * from that date, never from where an earlier tap moved it: Wednesday then Saturday, tapped on a
 * Thursday, starts this Saturday, not next Wednesday.
 */
export function repeatStart(from: string, mask: number): string {
  if (!mask) return from;
  let day = from;
  while (!(mask & bitOf(day))) day = addDays(day, 1);
  return day;
}
