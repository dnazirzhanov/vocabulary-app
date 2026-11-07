import { wordsLabel } from './pace.ts';
import { t } from '../i18n/index.ts';

/**
 * A teacher's «Выучить к» on a deck (ADR 0028), in words. Dates are local calendar days
 * ("2026-11-07"): plain calendar arithmetic.
 */

const DAY_MS = 86_400_000;
const toTime = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** Today's local date as YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** «7 ноября». */
export const dueLabel = (day: string) => {
  const date = new Date(toTime(day));
  return t.dayMonth(date.getUTCDate(), date.getUTCMonth());
};

/** A deck from a group in «Мои колоды»: «до срока 2 дня, осталось 6 слов». */
export function deadlineLeft(deadline: string, today: string, left: number): string {
  const days = Math.round((toTime(deadline) - toTime(today)) / DAY_MS);
  if (left <= 0) return t.byAllWordsMet(dueLabel(deadline));
  const rest = t.left(wordsLabel(left));
  if (days < 0) return t.deadlinePassed(rest);
  if (days === 0) return t.deadlineToday(rest);
  if (days === 1) return t.deadlineTomorrow(rest);
  return t.deadlineInDays(days, rest);
}
