import { plural } from '../i18n/plural.ts';
import { wordsLabel } from './pace.ts';

/**
 * A teacher's «Выучить к» on a deck (ADR 0028), in words. Dates are local calendar days
 * ("2026-11-07"): plain calendar arithmetic.
 */

const DAY_MS = 86_400_000;
const dayName = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const toTime = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** Today's local date as YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** «7 ноября». */
export const dueLabel = (day: string) => dayName.format(toTime(day));

/** A deck from a group in «Мои колоды»: «до срока 2 дня, осталось 6 слов». */
export function deadlineLeft(deadline: string, today: string, left: number): string {
  const days = Math.round((toTime(deadline) - toTime(today)) / DAY_MS);
  if (left <= 0) return `к ${dueLabel(deadline)}: все слова встречены`;
  const rest = `осталось ${wordsLabel(left)}`;
  if (days < 0) return `срок прошёл, ${rest}`;
  if (days === 0) return `срок сегодня, ${rest}`;
  if (days === 1) return `срок завтра, ${rest}`;
  return `до срока ${days}\u00a0${plural(days, { one: 'день', few: 'дня', many: 'дней' })}, ${rest}`;
}
