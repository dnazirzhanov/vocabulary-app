/**
 * Date, time and repeat for a task (ADR 0084), as TickTick's date sheet: quick choices, a month,
 * a time, and a repeat. Changes are reported as they are made; the caller decides when to keep them.
 */
import { useState } from 'react';
import { t, uiLanguage } from '../i18n/index.ts';
import { BackIcon, ForwardIcon } from '../ui/icons.tsx';
import { addDays, hhmm, weekday } from './dates.ts';
import styles from './Planner.module.css';

export interface When {
  dueOn: string | null;
  startMinute: number | null;
  repeatMask: number;
}

type RepeatChoice = 'none' | 'daily' | 'weekdays' | 'weekends' | 'weekly' | 'days';

export function repeatChoice(mask: number): RepeatChoice {
  if (!mask) return 'none';
  if (mask === 127) return 'daily';
  if (mask === 31) return 'weekdays';
  if (mask === 96) return 'weekends';
  if ((mask & (mask - 1)) === 0) return 'weekly';
  return 'days';
}

/** «Каждый день», «По будням», «Пн, Ср»… */
export function repeatLabel(mask: number): string {
  const choice = repeatChoice(mask);
  if (choice === 'none') return '';
  if (choice === 'daily') return t.planRepeatDaily;
  if (choice === 'weekdays') return t.planRepeatWeekdays;
  if (choice === 'weekends') return t.planRepeatWeekends;
  return t.weekdays.filter((_, d) => mask & (1 << d)).join(', ');
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
    when.startMinute !== null ? hhmm(when.startMinute) : '',
    repeatLabel(when.repeatMask),
  ];
  return parts.filter(Boolean).join(' · ');
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
    { label: t.planNoDate, day: null },
  ];
  const choice = repeatChoice(value.repeatMask);
  const pickRepeat = (next: RepeatChoice) => {
    const base = value.dueOn ?? today;
    const masks: Record<RepeatChoice, number> = {
      none: 0,
      daily: 127,
      weekdays: 31,
      weekends: 96,
      weekly: 1 << weekday(base),
      days: value.repeatMask || 1 << weekday(base),
    };
    set({ repeatMask: masks[next], dueOn: next === 'none' ? value.dueOn : base });
  };
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
            onClick={() => set({ dueOn: q.day, ...(q.day === null ? { repeatMask: 0 } : {}) })}
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
                onClick={() => set({ dueOn: day })}
              >
                {Number(day.slice(8))}
              </button>
            ) : (
              <span key={`blank-${i}`} />
            ),
          )}
        </div>
      </div>
      <label className={styles.pickRow}>
        <span>{t.planTime}</span>
        <span className={styles.pickValue}>
          <input
            type="time"
            className={styles.timeInput}
            value={value.startMinute === null ? '' : hhmm(value.startMinute)}
            onChange={(e) => {
              const [h, m] = e.target.value.split(':').map(Number);
              set({ startMinute: e.target.value ? h * 60 + m : null });
            }}
          />
          {value.startMinute !== null && (
            <button type="button" className={styles.textBtn} onClick={() => set({ startMinute: null })}>
              {t.planNoTime}
            </button>
          )}
        </span>
      </label>
      <label className={styles.pickRow}>
        <span>{t.planRepeat}</span>
        <select className={styles.select} value={choice} onChange={(e) => pickRepeat(e.target.value as RepeatChoice)}>
          <option value="none">{t.planRepeatNone}</option>
          <option value="daily">{t.planRepeatDaily}</option>
          <option value="weekdays">{t.planRepeatWeekdays}</option>
          <option value="weekends">{t.planRepeatWeekends}</option>
          <option value="weekly">{t.planRepeatWeekly}</option>
          <option value="days">{t.planRepeatDays}</option>
        </select>
      </label>
      {choice === 'days' || choice === 'weekly' ? (
        <div className={styles.weekToggles} role="group" aria-label={t.planRepeatDays}>
          {t.weekdays.map((d, i) => (
            <button
              key={d}
              type="button"
              className={styles.weekToggle}
              aria-pressed={Boolean(value.repeatMask & (1 << i))}
              onClick={() => {
                const next = value.repeatMask ^ (1 << i);
                if (next) set({ repeatMask: next, dueOn: value.dueOn ?? today });
              }}
            >
              {d}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
