import { useState } from 'react';
import { daysAfterOf, plural } from '../i18n/plural.ts';
import { wordsLabel } from '../lib/pace.ts';
import { buildYear, weekProgress, yearsOf, type Cell, type Level } from '../lib/consistency.ts';
import type { Progress } from '../lib/types.ts';
import { BackIcon, CheckIcon, ForwardIcon } from '../ui/icons.tsx';
import styles from './Progress.module.css';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const LEVEL_NAME: Record<Level, string> = { 0: 'без занятий', 1: 'были занятия', 2: 'план выполнен' };
const dayName = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const dayWord = (n: number) => plural(n, { one: 'день', few: 'дня', many: 'дней' });
const describe = (cell: Cell) => `${dayName.format(Date.parse(`${cell.date}T00:00:00Z`))}: ${LEVEL_NAME[cell.level]}`;
const cardsWord = (n: number) => plural(n, { one: 'карточка', few: 'карточки', many: 'карточек' });
const number = new Intl.NumberFormat('ru');
/** One day of the heatmap in words: its date, cards answered, and whether the plan was done. */
const dayLine = (cell: Cell) => {
  const date = dayName.format(Date.parse(`${cell.date}T00:00:00Z`));
  if (cell.cards === 0) return `${date}: без занятий`;
  return `${date}: ${number.format(cell.cards)} ${cardsWord(cell.cards)}${cell.level === 2 ? ' · план выполнен' : ''}`;
};

/**
 * Consistency without a streak to lose: this week against the days the learner promised, and a
 * whole year of days, January to December, shaded by the cards answered each day.
 */
export function Consistency({ progress }: { progress: Progress }) {
  const today = progress.today.date;
  const target = progress.today.target;
  const week = weekProgress(progress.activity, today, progress.promised_days);
  const years = yearsOf(progress.activity, today);
  const [year, setYear] = useState(years[years.length - 1]);
  const calendar = buildYear(progress.activity, today, year);
  const left = week.target - week.done;
  const [picked, setPicked] = useState<string | null>(null);
  const pickedCell = calendar.months.flatMap((month) => month.days).find((cell) => cell.date === picked);
  const pick = (target: EventTarget) => {
    const date = (target as HTMLElement).dataset.date;
    if (date) setPicked(date);
  };

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

      <div className={styles.heatHead}>
        <h3 className={styles.heatTitle}>Карточки по дням</h3>
        <div className={styles.yearSwitch}>
          <button
            type="button"
            aria-label="Предыдущий год"
            disabled={year <= years[0]}
            onClick={() => (setYear(year - 1), setPicked(null))}
          >
            <BackIcon aria-hidden="true" />
          </button>
          <span aria-live="polite">{year}</span>
          <button
            type="button"
            aria-label="Следующий год"
            disabled={year >= years[years.length - 1]}
            onClick={() => (setYear(year + 1), setPicked(null))}
          >
            <ForwardIcon aria-hidden="true" />
          </button>
        </div>
      </div>
      {/* Twelve month calendars, weeks from Monday. Hover or tap a day to read it under the grid;
          for screen readers the year is one image, summed up in its label and the line below. */}
      <div
        className={styles.year}
        role="img"
        aria-label={`${year}: ${calendar.activeDays} ${dayWord(calendar.activeDays)} с занятиями, из них ${calendar.goalDays} с выполненным планом`}
        onPointerOver={(event) => pick(event.target)}
        onPointerLeave={(event) => event.pointerType === 'mouse' && setPicked(null)}
        onClick={(event) => pick(event.target)}
      >
        {calendar.months.map((month) => (
          <div key={month.label} className={styles.month}>
            <span className={styles.monthName}>{month.label}</span>
            <div className={styles.monthDays}>
              {month.days.map((cell, index) => (
                <i
                  key={cell.date}
                  className={styles.cell}
                  data-shade={cell.shade}
                  data-date={cell.future ? undefined : cell.date}
                  data-future={cell.future || undefined}
                  data-today={cell.date === today || undefined}
                  data-picked={cell.date === picked || undefined}
                  title={cell.future ? undefined : dayLine(cell)}
                  style={index === 0 ? { gridColumnStart: month.offset + 1 } : undefined}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className={styles.scale} aria-hidden="true">
        <span>меньше</span>
        {([0, 1, 2, 3, 4] as const).map((shade) => (
          <i key={shade} className={styles.cell} data-shade={shade} />
        ))}
        <span>больше</span>
      </p>
      <p className={styles.heatCaption} aria-live="polite">
        {pickedCell
          ? dayLine(pickedCell)
          : `${year}: ${calendar.activeDays} ${dayWord(calendar.activeDays)} с занятиями · ${number.format(calendar.cards)} ${cardsWord(calendar.cards)}`}
      </p>
      <p className={styles.footnote}>
        {target > 0
          ? `День засчитывается, когда сделаны все повторения и ${wordsLabel(target)} за день.`
          : 'Новых слов на сегодня нет: день засчитается, когда сделаны все повторения.'}
      </p>
    </section>
  );
}
