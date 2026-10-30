import { wordsLabel } from './pace.ts';

/**
 * A teacher's «Выучить к» on a deck (ADR 0028), in words: the date, and what today asks for.
 * Words are spread evenly over the days before the deadline, which is left for review. Dates are
 * local calendar days ("2026-11-07"): plain calendar arithmetic.
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

/**
 * The deadline line on a deck's page; null without a deadline, or once it has passed with every
 * word met. `share` is today's even share, `left` the words not met yet, `pace` the deck's own new
 * words a day: when it already covers the share, the learner just keeps it.
 */
export function deadlineNote(
  deadline: string | null,
  today: string,
  share: number,
  left: number,
  pace: number,
): string | null {
  if (!deadline) return null;
  const days = Math.round((toTime(deadline) - toTime(today)) / DAY_MS);
  const date = dueLabel(deadline);
  if (days < 0) return left > 0 ? `Срок был ${date}: осталось ${wordsLabel(left)} — сегодня все.` : null;
  if (days === 0)
    return left > 0
      ? `Срок — сегодня: осталось ${wordsLabel(left)}.`
      : 'Срок — сегодня. Все слова встречены: повторите их.';
  if (left === 0) return `Выучить к ${date}. Все слова встречены — до срока остаются повторения.`;
  if (days === 1) return `Выучить к ${date} — это завтра: сегодня все ${wordsLabel(left)}, завтра повторение.`;
  if (share <= pace) return `Выучить к ${date}. Вашего темпа хватает, чтобы успеть с запасом на повторение.`;
  return `Выучить к ${date}. Сегодня ${wordsLabel(share)}, чтобы успеть, — последний день останется для повторения.`;
}
