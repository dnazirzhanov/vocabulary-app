import { useSyncExternalStore } from 'react';
import { daysAfterOf, plural } from '../i18n/plural.ts';
import { wordsLabel } from '../lib/pace.ts';
import { buildCalendar, weekProgress, type Cell, type Level } from '../lib/consistency.ts';
import type { Progress } from '../lib/types.ts';
import { CheckIcon } from '../ui/icons.tsx';
import styles from './Progress.module.css';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
// Weekday names are shown on alternate rows, as on GitHub's calendar.
const LABELLED_ROWS = new Set([0, 2, 4]);
const LEVEL_NAME: Record<Level, string> = { 0: 'без занятий', 1: 'были занятия', 2: 'план выполнен' };
const dayName = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const dayWord = (n: number) => plural(n, { one: 'день', few: 'дня', many: 'дней' });
const describe = (cell: Cell) => `${dayName.format(Date.parse(`${cell.date}T00:00:00Z`))}: ${LEVEL_NAME[cell.level]}`;

const WIDE = '(min-width: 640px)';
const subscribe = (notify: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};
/** Half a year on a wide screen; on a phone fewer weeks, so a day stays big enough to see. */
const useWeekCount = () => (useSyncExternalStore(subscribe, () => window.matchMedia(WIDE).matches) ? 26 : 18);

/**
 * Consistency without a streak to lose: this week against the days the learner promised, and a
 * calendar of the weeks before. A day with the plan done is solid, a lighter one had some learning.
 */
export function Consistency({ progress }: { progress: Progress }) {
  const today = progress.today.date;
  const target = progress.today.target;
  const week = weekProgress(progress.activity, today, progress.promised_days);
  const calendar = buildCalendar(progress.activity, today, useWeekCount());
  const left = week.target - week.done;

  return (
    <section aria-labelledby="consistency-heading">
      <h2 id="consistency-heading" className={styles.sectionTitle}>
        Регулярность
      </h2>
      <p className={styles.hero}>
        <strong>{week.done}</strong>{' '}
        <span>
          из {week.target} {daysAfterOf(week.target)} на этой неделе
        </span>
      </p>
      <ol className={styles.week} aria-label="Дни этой недели">
        {week.days.map((day, index) => (
          <li
            key={day.date}
            className={styles.weekDay}
            data-level={day.level}
            data-future={day.future || undefined}
            data-today={index === week.todayIndex || undefined}
            aria-label={describe(day)}
            aria-current={index === week.todayIndex ? 'date' : undefined}
          >
            <span className={styles.weekDot}>{day.level === 2 && <CheckIcon aria-hidden="true" />}</span>
            <span className={styles.weekName} aria-hidden="true">
              {WEEKDAYS[index]}
            </span>
          </li>
        ))}
      </ol>
      <p className={styles.weekNote}>
        {left <= 0 ? (
          <>
            <CheckIcon aria-hidden="true" /> Цель недели выполнена
          </>
        ) : (
          // Only a nudge toward what is still possible; a week that can no longer be met says nothing.
          week.days.filter((day) => day.future || day.date === today).length >= left &&
          `Ещё ${left} ${dayWord(left)} до цели недели`
        )}
      </p>

      <div
        className={styles.calendar}
        role="img"
        aria-label={`${calendar.goalDays} ${dayWord(calendar.goalDays)} с выполненным планом за ${calendar.weeks.length} недель`}
        style={{ gridTemplateColumns: `auto repeat(${calendar.weeks.length}, minmax(0, 1fr))` }}
      >
        {calendar.months.map((month) => (
          <span key={month.week} className={styles.month} style={{ gridColumn: `${month.week + 2} / span 3` }}>
            {month.label}
          </span>
        ))}
        {WEEKDAYS.map((name, row) => (
          <span key={name} className={styles.rowName} style={{ gridRow: row + 2 }}>
            {LABELLED_ROWS.has(row) ? name : ''}
          </span>
        ))}
        {calendar.weeks.map((cells, column) =>
          cells.map((cell, row) => (
            <i
              key={cell.date}
              className={styles.cell}
              data-level={cell.level}
              data-future={cell.future || undefined}
              data-today={cell.date === today || undefined}
              title={cell.future ? undefined : describe(cell)}
              style={{ gridColumn: column + 2, gridRow: row + 2 }}
            />
          )),
        )}
      </div>
      <p className={styles.legend}>
        <span>
          <i className={styles.cell} data-level="1" aria-hidden="true" /> были занятия
        </span>
        <span>
          <i className={styles.cell} data-level="2" aria-hidden="true" /> план выполнен
        </span>
      </p>
      <p className={styles.footnote}>
        {target > 0
          ? `День засчитывается, когда выполнен ваш план: ${wordsLabel(target)} за день.`
          : 'Сегодня план — повторения: день засчитается, когда урок закончен.'}
      </p>
    </section>
  );
}
