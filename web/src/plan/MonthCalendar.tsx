import { useState } from 'react';
import { plural } from '../i18n/plural.ts';
import type { CalendarDay, CalendarMonth } from '../lib/roadmap.ts';
import { BackIcon, FlagIcon } from '../ui/icons.tsx';
import styles from './Plan.module.css';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const monthName = new Intl.DateTimeFormat('ru', { month: 'long' });
const monthGenitive = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' });
const fullDate = new Intl.DateTimeFormat('ru', { weekday: 'long', day: 'numeric', month: 'long' });
const words = (n: number) =>
  `${n.toLocaleString('ru-RU')}\u00a0${plural(n, { one: 'слово', few: 'слова', many: 'слов' })}`;

const title = (month: CalendarMonth) => {
  const name = monthName.format(new Date(month.year, month.month, 1));
  return `${name[0].toUpperCase()}${name.slice(1)} ${month.year}`;
};

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
 * One month at a time. Every day of the plan shows a single number: how many words the learner
 * will know by the end of that day if the pace holds. Rest days keep yesterday's number, greyed.
 */
export function MonthCalendar({ months }: { months: CalendarMonth[] }) {
  const [index, setIndex] = useState(0);
  const month = months[Math.min(index, months.length - 1)];
  if (!month) return null;
  const planDays = month.weeks.flat().filter((day): day is CalendarDay => day?.kind === 'plan');
  const last = planDays[planDays.length - 1];
  const finishMonth = months.length - 1;

  return (
    <section className={styles.calendar} aria-label="Календарь плана">
      <div className={styles.calendarHead}>
        <button
          type="button"
          className={styles.navButton}
          onClick={() => setIndex(index - 1)}
          disabled={index === 0}
          aria-label="Предыдущий месяц"
        >
          <BackIcon aria-hidden="true" />
        </button>
        <h3 className={styles.monthTitle} aria-live="polite">
          {title(month)}
        </h3>
        <button
          type="button"
          className={`${styles.navButton} ${styles.navNext}`}
          onClick={() => setIndex(index + 1)}
          disabled={index >= finishMonth}
          aria-label="Следующий месяц"
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
          {month.weeks.map((week, row) => (
            <tr key={row}>
              {week.map((day, column) =>
                day ? (
                  <td
                    key={column}
                    className={styles.cell}
                    data-kind={day.kind}
                    data-rest={(day.kind === 'plan' && !day.study) || undefined}
                    data-today={day.today || undefined}
                    data-milestone={day.milestone ? true : undefined}
                    data-finish={day.finish || undefined}
                    aria-label={label(day)}
                  >
                    <span className={styles.cellDate} aria-hidden="true">
                      {day.date.getDate()}
                    </span>
                    {day.kind === 'plan' && (
                      <span className={styles.cellTotal} aria-hidden="true">
                        {day.total}
                      </span>
                    )}
                    {day.finish && <FlagIcon className={styles.cellFlag} />}
                  </td>
                ) : (
                  <td key={column} />
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.calendarFoot}>
        {last && (
          <p>
            {last.finish ? 'Цель — ' : 'К '}
            {monthGenitive.format(last.date)}: <strong>{words(last.total)}</strong>
          </p>
        )}
        {index < finishMonth && (
          <button type="button" className={styles.linkButton} onClick={() => setIndex(finishMonth)}>
            К финишу
          </button>
        )}
        {index > 0 && (
          <button type="button" className={styles.linkButton} onClick={() => setIndex(0)}>
            К сегодня
          </button>
        )}
      </div>
    </section>
  );
}
