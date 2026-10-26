import type { ReactNode } from 'react';
import { plural } from '../i18n/plural.ts';
import { buildRoadmap, calendarMonths, milestones, type RoadmapInput } from '../lib/roadmap.ts';
import { MonthCalendar } from './MonthCalendar.tsx';
import styles from './Plan.module.css';

const dayMonth = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' });
const dayMonthYear = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', year: 'numeric' });
const short = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' });
const n = (value: number) => value.toLocaleString('ru-RU');
const words = (value: number) => `${n(value)}\u00a0${plural(value, { one: 'слово', few: 'слова', many: 'слов' })}`;

interface PlanViewProps {
  input: RoadmapInput;
  /** Words that exist in the app today (the rest of the course is still being written). */
  deckWords: number;
  /** Pace controls, shown between the promise and the calendar. */
  controls?: ReactNode;
}

/** "If you keep this pace": the goal date, the round numbers on the way, and a day-by-day calendar. */
export function PlanView({ input, deckWords, controls }: PlanViewProps) {
  const roadmap = buildRoadmap(input);
  const marks = milestones(roadmap, input.totalWords, input.introduced);
  const date = (day: Date) => (day.getFullYear() === input.today.getFullYear() ? dayMonth : dayMonthYear).format(day);
  const known = input.introduced;

  return (
    <div className={styles.plan}>
      <div className={styles.promise}>
        <p className={styles.eyebrow}>Если сохранить этот темп</p>
        <p className={styles.goalLine}>
          <strong>{words(input.totalWords)}</strong>
          {roadmap.finish ? <> — к&nbsp;{date(roadmap.finish)}</> : known >= input.totalWords ? ' — уже ваши' : null}
        </p>
        <p className={styles.today}>
          {known > 0 ? `Сегодня вы знаете ${words(known)}.` : 'Сегодня — первые слова.'} Число в каждом дне — сколько
          слов вы будете знать к его концу.
        </p>
      </div>
      {controls}
      {roadmap.finish && <MonthCalendar months={calendarMonths(roadmap, marks)} />}
      {marks.length > 1 && (
        <section className={styles.milestonesBlock} aria-labelledby="milestones-title">
          <h3 id="milestones-title" className={styles.subTitle}>
            Рубежи
          </h3>
          <ol className={styles.milestones}>
            {marks.map((mark) => (
              <li key={mark.words} data-goal={mark.goal || undefined}>
                <strong>{n(mark.words)}</strong>
                <span>{short.format(mark.date)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
      {input.totalWords > deckWords && (
        <p className={styles.note}>
          Сейчас в приложении {words(deckWords)}, остальные слова курса добавляются постепенно. Даты — при этом темпе и
          если повторять в нужные дни.
        </p>
      )}
    </div>
  );
}
