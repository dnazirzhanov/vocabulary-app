import { dueLabel } from '../lib/deadline.ts';
import { useState } from 'react';
import { rich } from '../i18n/rich.tsx';
import { promiseText, weekdaysOf } from '../lib/promise.ts';
import { PromiseDialog } from '../promise/PromiseDialog.tsx';
import { buildYear, weekProgress, yearsOf, type Cell, type Level } from '../lib/consistency.ts';
import type { Progress } from '../lib/types.ts';
import { BackIcon, CheckIcon, ForwardIcon, PencilIcon } from '../ui/icons.tsx';
import styles from './Progress.module.css';
import { t } from '../i18n/index.ts';

const WEEKDAYS = t.weekdays;
const LEVEL_NAME: Record<Level, string> = { 0: t.noStudy, 1: t.startedNotFinished, 2: t.dayCounted };

const describe = (cell: Cell) => `${dueLabel(cell.date)}: ${LEVEL_NAME[cell.level]}`;

/** One day of the heatmap in words: its date, cards answered, and whether it counts. */
const dayLine = (cell: Cell) => {
  const date = dueLabel(cell.date);
  if (cell.cards === 0) return t.noStudyOn(date);
  return t.dayCards(date, cell.cards, cell.level === 2);
};

/**
 * This week against the days promised (ADR 0015, 0027): seven dots and one line, for the summary at
 * the top of «Прогресс» (ADR 0034).
 */
export function WeekDays({ progress, onPromiseChanged }: { progress: Progress; onPromiseChanged?: () => void }) {
  const today = progress.today.date;
  const week = weekProgress(progress.activity, today, progress.promised_week);
  const [editing, setEditing] = useState(false);
  const left = week.target - week.done;
  // Only a nudge toward what is still possible; a week that can no longer be met says nothing.
  const reachable = week.days.filter((day) => day.future || day.date === today).length >= left;
  const promise = week.target > 0 ? promiseText(weekdaysOf(progress.promised_week)) : t.pausedThisWeek;
  return (
    <div className={styles.weekBlock}>
      {/* The picture says which days are promised (a ring) and which aren't (a dot); the words are
          for screen readers. Changing it is the pencil beside it. */}
      <div className={styles.weekRow}>
        <ol className={styles.week} aria-label={`${t.daysOfThisWeek}. ${t.promise} ${promise}`}>
          {week.days.map((day, index) => (
            <li
              key={day.date}
              className={styles.weekDay}
              data-level={day.level}
              data-future={day.future || undefined}
              data-off={(!day.promised && day.level === 0) || undefined}
              data-today={index === week.todayIndex || undefined}
              aria-label={day.promised || day.level > 0 ? describe(day) : `${describe(day)}, ${t.notPromised}`}
              aria-current={index === week.todayIndex ? 'date' : undefined}
            >
              <span className={styles.weekDot}>{day.level === 2 && <CheckIcon aria-hidden="true" />}</span>
              <span className={styles.weekName} aria-hidden="true">
                {WEEKDAYS[index]}
              </span>
            </li>
          ))}
        </ol>
        <button type="button" className={styles.weekEdit} aria-label={t.editPromise} onClick={() => setEditing(true)}>
          <PencilIcon aria-hidden="true" />
        </button>
      </div>
      {week.target === 0 && <p className={styles.weekNote}>{t.pausedThisWeek}</p>}
      {week.target > 0 && (
        <p className={styles.weekNote}>
          {rich(t.weekDaysDone(week.target), <strong>{week.done}</strong>)}
          {left <= 0 ? (
            <span className={styles.weekDone}>
              {' '}
              · <CheckIcon aria-hidden="true" /> {t.thisWeekSPromiseIsKept}
            </span>
          ) : (
            reachable && t.daysLeftToGoal(left)
          )}
        </p>
      )}
      {editing && (
        <PromiseDialog
          onClose={() => {
            setEditing(false);
            onPromiseChanged?.();
          }}
        />
      )}
    </div>
  );
}

/** A whole year of days, January to December, shaded by the cards answered each day. */
export function Heatmap({ progress }: { progress: Progress }) {
  const today = progress.today.date;
  const years = yearsOf(progress.activity, today);
  const [year, setYear] = useState(years[years.length - 1]);
  const calendar = buildYear(progress.activity, today, year);
  const [picked, setPicked] = useState<string | null>(null);
  const pickedCell = calendar.months.flatMap((month) => month.days).find((cell) => cell.date === picked);
  const pick = (target: EventTarget) => {
    const date = (target as HTMLElement).dataset.date;
    if (date) setPicked(date);
  };

  return (
    <section aria-labelledby="heat-heading" className={styles.heat}>
      <div className={styles.heatHead}>
        <h2 id="heat-heading" className={styles.heatTitle}>
          {t.cardsByDay}
        </h2>
        <div className={styles.yearSwitch}>
          <button
            type="button"
            aria-label={t.previousYear}
            disabled={year <= years[0]}
            onClick={() => (setYear(year - 1), setPicked(null))}
          >
            <BackIcon aria-hidden="true" />
          </button>
          <span aria-live="polite">{year}</span>
          <button
            type="button"
            aria-label={t.nextYear}
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
        aria-label={t.yearCounted(year, calendar.activeDays, calendar.studiedDays)}
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
        <span>{t.less}</span>
        {([0, 1, 2, 3, 4] as const).map((shade) => (
          <i key={shade} className={styles.cell} data-shade={shade} />
        ))}
        <span>{t.moreLegend}</span>
      </p>
      <p className={styles.heatCaption} aria-live="polite">
        {pickedCell ? dayLine(pickedCell) : t.yearCards(year, calendar.activeDays, calendar.cards)}
      </p>
    </section>
  );
}
