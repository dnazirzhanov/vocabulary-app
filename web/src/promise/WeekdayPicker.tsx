import { PROMISE_PRESETS, sameDays, WEEKDAY_NAMES } from '../lib/promise.ts';
import styles from './WeekdayPicker.module.css';
import { t } from '../i18n/index.ts';

/**
 * The weekdays a learner promises (ADR 0039): seven toggles, at least one on, and two presets for
 * the usual choices. Used on the first-run screen and in the promise window.
 */
export function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (weekdays: number[]) => void }) {
  const toggle = (weekday: number) => {
    const on = value.includes(weekday);
    if (on && value.length === 1) return; // a promise needs a day
    onChange(on ? value.filter((day) => day !== weekday) : [...value, weekday].sort((a, b) => a - b));
  };
  return (
    <div className={styles.picker}>
      <div className={styles.days} role="group" aria-label={t.daysOfTheWeek}>
        {WEEKDAY_NAMES.map((name, weekday) => (
          <button key={name} type="button" aria-pressed={value.includes(weekday)} onClick={() => toggle(weekday)}>
            {name}
          </button>
        ))}
      </div>
      <div className={styles.presets}>
        {PROMISE_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            aria-pressed={sameDays(value, preset.weekdays)}
            onClick={() => onChange(preset.weekdays)}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
