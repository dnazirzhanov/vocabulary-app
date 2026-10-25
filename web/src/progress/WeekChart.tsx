import { plural } from '../i18n/plural.ts';
import type { DayActivity } from '../lib/types.ts';
import styles from './WeekChart.module.css';

const weekday = new Intl.DateTimeFormat('ru', { weekday: 'short' });
const fullDate = new Intl.DateTimeFormat('ru', { weekday: 'long', day: 'numeric', month: 'long' });
const points = (n: number) => `${n}\u00a0${plural(n, { one: 'очко', few: 'очка', many: 'очков' })}`;

// API dates are the learner's local calendar days; build them in local time to avoid UTC shifts.
function localDate(isoDay: string): Date {
  const [year, month, day] = isoDay.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Points per day for the last week: one series, so one hue and no legend (the title names it).
 * Columns are capped at 24px; the goal is a solid hairline; only today's value is labelled,
 * the rest live in the tooltip (hover or focus) and the table view.
 */
export function WeekChart({ days, goal }: { days: DayActivity[]; goal: number }) {
  const scale = Math.max(goal * 1.25, ...days.map((day) => day.points));
  const today = days[days.length - 1];
  return (
    <figure className={styles.figure}>
      <figcaption className={styles.title}>Очки за 7 дней</figcaption>
      <div className={styles.plot}>
        <div className={styles.goal} style={{ bottom: `${(goal / scale) * 100}%` }} aria-hidden="true">
          <span className={styles.goalLabel}>цель {goal}</span>
        </div>
        {days.map((day) => {
          const date = localDate(day.date);
          const isToday = day === today;
          return (
            <div
              key={day.date}
              className={styles.column}
              tabIndex={0}
              role="img"
              aria-label={`${fullDate.format(date)}: ${points(day.points)}`}
            >
              <div className={styles.barArea}>
                {day.points > 0 && (
                  <div className={styles.bar} style={{ height: `${(day.points / scale) * 100}%` }}>
                    {isToday && <span className={styles.value}>{day.points}</span>}
                  </div>
                )}
                <span className={styles.tooltip} aria-hidden="true">
                  <strong>{points(day.points)}</strong>
                  <span>{fullDate.format(date)}</span>
                </span>
              </div>
              <span className={styles.day} data-today={isToday || undefined} aria-hidden="true">
                {isToday ? 'сегодня' : weekday.format(date)}
              </span>
            </div>
          );
        })}
      </div>
      <details className={styles.table}>
        <summary>Показать таблицей</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">День</th>
              <th scope="col">Очки</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date}>
                <td>{fullDate.format(localDate(day.date))}</td>
                <td>{day.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
