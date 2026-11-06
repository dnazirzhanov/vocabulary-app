import { t } from '../i18n/index.ts';
import { serverNow } from './clock.ts';

const DAY_MS = 86_400_000;

/** "сегодня", "завтра", "через 3 дня" — by the learner's local calendar, not by 24-hour blocks. */
export function relativeDay(moment: string | Date, now: Date = serverNow()): string {
  const target = new Date(moment);
  const startOf = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startOf(target) - startOf(now)) / DAY_MS);
  return t.inDays(Math.max(days, 0));
}
