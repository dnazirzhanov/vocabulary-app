import { plural } from '../i18n/plural.ts';

/**
 * A deck's goal on «Прогресс» (ADR 0033), in one line: today's new words, then the finish — the
 * teacher's deadline, or about how many days at the deck's own pace. Nothing judged, only told.
 */
export interface DeckGoalInput {
  word_count: number;
  met: number;
  new_today: number;
  goal_today: number;
  pace: number;
  /** «к 2 ноября», already worded; null without a deadline. */
  deadline: string | null;
}

const words = (n: number) => `${n}\u00a0${plural(n, { one: 'слово', few: 'слова', many: 'слов' })}`;
const days = (n: number) => `${n}\u00a0${plural(n, { one: 'день', few: 'дня', many: 'дней' })}`;

export function deckGoal({ word_count, met, new_today, goal_today, pace, deadline }: DeckGoalInput): {
  text: string;
  /** Today's words are still to do: the line asks for attention. */
  pending: boolean;
} {
  const left = Math.max(0, word_count - met);
  if (left === 0) return { text: 'Все слова встречены — дальше повторения', pending: false };
  const pending = goal_today > 0 && new_today < goal_today;
  const today = goal_today > 0 ? (pending ? `сегодня ${new_today} из ${goal_today} новых` : 'на сегодня ✓') : null;
  const finish =
    deadline ?? (pace > 0 ? `осталось ${words(left)} ≈ ${days(Math.ceil(left / pace))}` : `осталось ${words(left)}`);
  return { text: [today, finish].filter(Boolean).join(' · '), pending };
}
