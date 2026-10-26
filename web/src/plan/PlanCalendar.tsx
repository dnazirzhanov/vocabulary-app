import { useState } from 'react';
import { plural } from '../i18n/plural.ts';
import type { CalendarDay } from '../lib/roadmap.ts';
import { BackIcon, FlagIcon } from '../ui/icons.tsx';
import styles from './Plan.module.css';

const WEEKS_PER_PAGE = 5;
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const shortMonth = new Intl.DateTimeFormat('ru', { month: 'short' });
const dayMonth = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' });
const rangeDay = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' });
const fullDate = new Intl.DateTimeFormat('ru', { weekday: 'long', day: 'numeric', month: 'long' });
const words = (n: number) =>
  `${n.toLocaleString('ru-RU')}\u00a0${plural(n, { one: 'слово', few: 'слова', many: 'слов' })}`;

function label(day: CalendarDay): string {
  if (day.kind !== 'plan') return fullDate.format(day.date);
  const parts = [fullDate.format(day.date)];
  if (day.today) parts.push('сегодня');
  parts.push(`вы будете знать ${words(day.total)}`);
  if (!day.study) parts.push('выходной');
  if (day.milestone) parts.push(`рубеж: ${words(day.milestone)}`);
  if (day.finish) parts.push('цель достигнута');
  return parts.join(', ');
}

/**
 * Five weeks at a time, starting with this week. Every day of the plan shows one number: how
 * many words the learner will know by the end of that day if the pace holds. The 1st of a month
 * names its month, so the weeks read on across month ends.
 */
export function PlanCalendar({ weeks }: { weeks: CalendarDay[][] }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(weeks.length / WEEKS_PER_PAGE));
  const current = Math.min(page, pages - 1);
  const shown = weeks.slice(current * WEEKS_PER_PAGE, (current + 1) * WEEKS_PER_PAGE);
  if (shown.length === 0) return null;
  const firstDay = shown[0][0].date;
  const lastDay = shown[shown.length - 1][6].date;
  const planDays = shown.flat().filter((day) => day.kind === 'plan');
  const last = planDays[planDays.length - 1];

  return (
    <section className={styles.calendar} aria-label="Календарь плана">
      <div className={styles.calendarHead}>
        <button
          type="button"
          className={styles.navButton}
          onClick={() => setPage(current - 1)}
          disabled={current === 0}
          aria-label="Предыдущие недели"
        >
          <BackIcon aria-hidden="true" />
        </button>
        <h3 className={styles.monthTitle} aria-live="polite">
          {rangeDay.format(firstDay)} – {rangeDay.format(lastDay)}
        </h3>
        <button
          type="button"
          className={`${styles.navButton} ${styles.navNext}`}
          onClick={() => setPage(current + 1)}
          disabled={current >= pages - 1}
          aria-label="Следующие недели"
        >
          <BackIcon aria-hidden="true" />
        </button>
      </div>
      <table className={styles.grid}>
        <thead>
          <tr>
            {WEEKDAYS.map((weekday) => (
              <th key={weekday} scope="col">
                {weekday}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((week, row) => (
            <tr key={row}>
              {week.map((day, column) => {
                const namesMonth = day.date.getDate() === 1 || (row === 0 && column === 0);
                return (
                  <td
                    key={column}
                    className={styles.cell}
                    data-kind={day.kind}
                    data-rest={(day.kind === 'plan' && !day.study) || undefined}
                    data-today={day.today || undefined}
                    data-finish={day.finish || undefined}
                    aria-label={label(day)}
                  >
                    <span className={styles.cellDate} aria-hidden="true">
                      {day.date.getDate()}
                      {namesMonth && <span className={styles.cellMonth}> {shortMonth.format(day.date)}</span>}
                    </span>
                    {day.kind === 'plan' && (
                      <span className={styles.cellTotal} aria-hidden="true">
                        {day.total}
                      </span>
                    )}
                    {day.milestone && !day.finish && <i className={styles.cellMilestone} aria-hidden="true" />}
                    {day.finish && <FlagIcon className={styles.cellFlag} />}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.calendarFoot}>
        {last && (
          <p>
            {last.finish ? 'Цель — ' : 'К '}
            {dayMonth.format(last.date)}: <strong>{words(last.total)}</strong>
          </p>
        )}
        <p className={styles.legend}>
          <i className={styles.legendDot} aria-hidden="true" /> рубеж (50, 100, 250… слов)
          <FlagIcon className={styles.legendFlag} aria-hidden="true" /> цель
        </p>
        <div className={styles.jumps}>
          {current < pages - 1 && (
            <button type="button" className={styles.linkButton} onClick={() => setPage(pages - 1)}>
              К финишу
            </button>
          )}
          {current > 0 && (
            <button type="button" className={styles.linkButton} onClick={() => setPage(0)}>
              К сегодня
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
