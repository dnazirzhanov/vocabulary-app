import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { buildRoadmap } from '../lib/roadmap.ts';
import type { Deck, Me, Pace } from '../lib/types.ts';
import { goalWordsOf, planInput } from '../plan/planInput.ts';
import styles from './HomeScreen.module.css';

const dayMonth = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' });
const dayMonthYear = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', year: 'numeric' });

/** The goal date at the current pace, one tap from the full calendar. */
export function PlanCard({ deck, pace, onOpen }: { deck: Deck; pace: Pace | null; onOpen: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    void api.me().then(setMe, () => undefined); // secondary on home: never blocks learning
  }, []);
  if (!me) return null;

  const input = planInput(
    deck,
    { words: me.daily_target_words ?? 5, days: me.study_days_per_week, ramp: me.ramp_enabled },
    pace?.new_words_today ?? 0,
    me.onboarded_at,
  );
  const finish = buildRoadmap(input).finish;
  const goal = goalWordsOf(deck).toLocaleString('ru-RU');
  const date = finish
    ? (finish.getFullYear() === input.today.getFullYear() ? dayMonth : dayMonthYear).format(finish)
    : null;
  return (
    <button type="button" className={styles.planCard} onClick={onOpen}>
      <span className={styles.planEyebrow}>Ваш план</span>
      <strong>{date ? `${goal} слов — к ${date}` : `${goal} слов — уже ваши`}</strong>
      <span>Посмотреть по дням, сколько слов вы будете знать</span>
    </button>
  );
}
