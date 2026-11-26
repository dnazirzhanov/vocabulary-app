/**
 * Date, time and repeat for a task (ADR 0084), as TickTick's date sheet: quick choices, a month,
 * a time, and a repeat. Changes are reported as they are made; the caller decides when to keep them.
 */
import { useState } from 'react';
import { t, uiLanguage } from '../i18n/index.ts';
import { BackIcon, ForwardIcon } from '../ui/icons.tsx';
import { addDays, hhmm, repeatStart, weekday } from './dates.ts';
import styles from './Planner.module.css';

export interface When {
  dueOn: string | null;
  startMinute: number | null;
  /** Until when, if set: after the start (ADR 0087). */
  endMinute: number | null;
  repeatMask: number;
}

/** «Каждый день», or the days themselves: «Ср, Сб». Nothing for a task that doesn't repeat. */
export function repeatLabel(mask: number): string {
  if (!mask) return '';
  if (mask === 127) return t.planRepeatDaily;
  return t.weekdays.filter((_, d) => mask & (1 << d)).join(', ');
}

/** «19:00», or «19:00–20:00» with an end. */
export function timeLabel(start: number | null, end: number | null | undefined): string {
  if (start === null) return '';
  return end ? `${hhmm(start)}–${hhmm(end)}` : hhmm(start);
}

/** «Сегодня», «Завтра», or «пт, 27 нояб.». */
export function dayLabel(day: string, today: string): string {
  if (day === today) return t.planToday;
  if (day === addDays(today, 1)) return t.planTomorrow;
  return new Date(`${day}T12:00:00`).toLocaleDateString(uiLanguage, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function whenLabel(when: When, today: string): string {
  const parts = [
    when.dueOn ? dayLabel(when.dueOn, today) : t.planNoDate,
    timeLabel(when.startMinute, when.endMinute),
    repeatLabel(when.repeatMask),
  ];
  return parts.filter(Boolean).join(' · ');
}

function minuteOf(value: string): number | null {
  if (!value) return null;
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

const monthStart = (day: string) => `${day.slice(0, 8)}01`;

function monthDays(first: string): (string | null)[] {
  const lead = weekday(first);
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let day = first; day.slice(0, 7) === first.slice(0, 7); day = addDays(day, 1)) cells.push(day);
  return cells;
}

export function DatePicker({ value, today, onChange }: { value: When; today: string; onChange: (when: When) => void }) {
  const [month, setMonth] = useState(monthStart(value.dueOn ?? today));
  const set = (patch: Partial<When>) => onChange({ ...value, ...patch });
  const nextMonday = addDays(today, 7 - weekday(today));
  const quick = [
    { label: t.planToday, day: today },
    { label: t.planTomorrow, day: addDays(today, 1) },
    { label: t.planNextMonday, day: nextMonday },
  ];
  // The date the person chose (a chip, the calendar, or today): a repeat counts from it, however
  // many weekdays are tapped after (ADR 0093).
  const [from, setFrom] = useState(value.dueOn ?? today);
  const pick = (day: string) => {
    setFrom(day);
    set({ dueOn: repeatStart(day, value.repeatMask) });
  };
  const repeatOn = (mask: number) => set({ repeatMask: mask, dueOn: mask ? repeatStart(from, mask) : from });
  const shift = (by: number) => {
    const d = new Date(`${month}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + by);
    setMonth(d.toISOString().slice(0, 8) + '01');
  };
  return (
    <div className={styles.picker}>
      <div className={styles.quick} role="group" aria-label={t.planDate}>
        {quick.map((q) => (
          <button
            key={q.label}
            type="button"
            className={styles.quickChip}
            aria-pressed={value.dueOn === q.day}
            onClick={() => pick(q.day)}
          >
            {q.label}
          </button>
        ))}
      </div>
      <div className={styles.month}>
        <div className={styles.monthHead}>
          <button type="button" className={styles.iconBtn} aria-label={t.planPrevMonth} onClick={() => shift(-1)}>
            <BackIcon aria-hidden="true" />
          </button>
          <span className={styles.monthName}>
            {new Date(`${month}T12:00:00`).toLocaleDateString(uiLanguage, { month: 'long', year: 'numeric' })}
          </span>
          <button type="button" className={styles.iconBtn} aria-label={t.planNextMonth} onClick={() => shift(1)}>
            <ForwardIcon aria-hidden="true" />
          </button>
        </div>
        <div className={styles.monthGrid} role="grid">
          {t.weekdays.map((d) => (
            <span key={d} className={styles.monthWeekday} aria-hidden="true">
              {d}
            </span>
          ))}
          {monthDays(month).map((day, i) =>
            day ? (
              <button
                key={day}
                type="button"
                className={styles.monthDay}
                aria-pressed={value.dueOn === day}
                aria-label={new Date(`${day}T12:00:00`).toLocaleDateString(uiLanguage, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
                data-today={day === today || undefined}
                data-past={day < today || undefined}
                onClick={() => pick(day)}
              >
                {Number(day.slice(8))}
              </button>
            ) : (
              <span key={`blank-${i}`} />
            ),
          )}
        </div>
      </div>
      <div className={styles.pickRow}>
        <span>{t.planTime}</span>
        <span className={styles.pickValue}>
          <input
            type="time"
            className={styles.timeInput}
            aria-label={t.planTime}
            value={value.startMinute === null ? '' : hhmm(value.startMinute)}
            onChange={(e) => {
              const start = minuteOf(e.target.value);
              const end =
                value.endMinute !== null && start !== null && value.endMinute > start ? value.endMinute : null;
              set({ startMinute: start, endMinute: end });
            }}
          />
          <span aria-hidden="true">–</span>
          <input
            type="time"
            className={styles.timeInput}
            aria-label={t.planUntil}
            disabled={value.startMinute === null}
            value={value.endMinute === null ? '' : hhmm(value.endMinute)}
            onChange={(e) => {
              const end = minuteOf(e.target.value);
              set({ endMinute: end !== null && value.startMinute !== null && end > value.startMinute ? end : null });
            }}
          />
          {value.startMinute !== null && (
            <button
              type="button"
              className={styles.textBtn}
              onClick={() => set({ startMinute: null, endMinute: null })}
            >
              {t.planNoTime}
            </button>
          )}
        </span>
      </div>
      <div className={styles.repeatBlock}>
        <span className={styles.repeatTitle}>{t.planRepeat}</span>
        <div className={styles.quick} role="group" aria-label={t.planRepeat}>
          <button
            type="button"
            className={styles.quickChip}
            aria-pressed={value.repeatMask === 0}
            onClick={() => repeatOn(0)}
          >
            {t.planRepeatNone}
          </button>
          <button
            type="button"
            className={styles.quickChip}
            aria-pressed={value.repeatMask === 127}
            onClick={() => repeatOn(127)}
          >
            {t.planRepeatDaily}
          </button>
        </div>
        {/* Any days: tap Ср and Сб for «Wednesday and Saturday». */}
        <div className={styles.weekToggles} role="group" aria-label={t.planRepeatDays}>
          {t.weekdays.map((d, i) => (
            <button
              key={d}
              type="button"
              className={styles.weekToggle}
              aria-pressed={Boolean(value.repeatMask & (1 << i))}
              onClick={() => repeatOn(value.repeatMask ^ (1 << i))}
            >
              {d}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
