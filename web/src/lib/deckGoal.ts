import { plural } from '../i18n/plural.ts';

/**
 * A deck on «Прогресс» in plain words (ADR 0034): where its words stand — «знаю» (recalled a day
 * or more later), «учу» (met, still settling), «впереди» (not met yet) — and its goal: today's new
 * words, then the finish, at the deck's own pace or by the teacher's date.
 */
export interface DeckGoalInput {
  word_count: number;
  met: number;
  learned: number;
  new_today: number;
  goal_today: number;
  pace: number;
  /** «к 2 ноября», already worded; null without a deadline. */
  deadline: string | null;
}

const days = (n: number) => `${n}\u00a0${plural(n, { one: 'день', few: 'дня', many: 'дней' })}`;

/** «знаю 21 · учу 47 · впереди 32», leaving out the parts at zero. */
export function deckStages({ word_count, met, learned }: DeckGoalInput): string {
  const parts: [string, number][] = [
    ['знаю', learned],
    ['учу', Math.max(0, met - learned)],
    ['впереди', Math.max(0, word_count - met)],
  ];
  return parts
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label} ${count}`)
    .join(' · ');
}

export function deckGoal({ word_count, met, new_today, goal_today, pace, deadline }: DeckGoalInput): {
  text: string;
  /** Today's words are still to do: the line asks for attention. */
  pending: boolean;
} {
  const left = Math.max(0, word_count - met);
  if (left === 0) return { text: 'Все слова пройдены — дальше повторения', pending: false };
  const still = Math.max(0, goal_today - new_today);
  const pending = goal_today > 0 && still > 0;
  const today = goal_today > 0 ? (pending ? `Сегодня: ${still} новых` : '✓ на сегодня') : null;
  const finish = deadline ?? (pace > 0 ? `≈ ${days(Math.ceil(left / pace))} до конца` : null);
  return { text: [today, finish].filter(Boolean).join(' · '), pending };
}
