import { useId } from 'react';
import { dailyMinutes, formatMinutes, MAX_TARGET, MIN_TARGET, PRESETS, RAMP_MIN_TARGET } from '../lib/pace.ts';
import type { PaceChoice } from './planInput.ts';
import styles from './Plan.module.css';

const DAY_OPTIONS = [5, 6, 7];
// One word at a time while small, then in fives.
const stepUp = (words: number) => Math.min(MAX_TARGET, words < 10 ? words + 1 : words + 5 - (words % 5));
const stepDown = (words: number) => Math.max(MIN_TARGET, words <= 10 ? words - 1 : words - (words % 5 || 5));

interface PlanControlsProps {
  value: PaceChoice;
  onChange: (value: PaceChoice) => void;
  secondsPerExercise: number;
}

/** The two numbers that move the whole plan: words a day and days a week. */
export function PlanControls({ value, onChange, secondsPerExercise }: PlanControlsProps) {
  const id = useId();
  const set = (changes: Partial<PaceChoice>) => onChange({ ...value, ...changes });
  return (
    <div className={styles.controls}>
      <div className={styles.control}>
        <span id={`${id}-words`} className={styles.controlLabel}>
          Новых слов в день
        </span>
        <div className={styles.stepper} role="group" aria-labelledby={`${id}-words`}>
          <button
            type="button"
            onClick={() => set({ words: stepDown(value.words) })}
            disabled={value.words <= MIN_TARGET}
            aria-label="Меньше"
          >
            −
          </button>
          <output aria-live="polite">{value.words}</output>
          <button
            type="button"
            onClick={() => set({ words: stepUp(value.words) })}
            disabled={value.words >= MAX_TARGET}
            aria-label="Больше"
          >
            +
          </button>
        </div>
        <div className={styles.presets}>
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={styles.preset}
              aria-pressed={value.words === preset.words}
              onClick={() => set({ words: preset.words })}
            >
              {preset.words}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.control}>
        <span id={`${id}-days`} className={styles.controlLabel}>
          Дней в неделю
        </span>
        <div className={styles.presets} role="group" aria-labelledby={`${id}-days`}>
          {DAY_OPTIONS.map((days) => (
            <button
              key={days}
              type="button"
              className={styles.preset}
              aria-pressed={value.days === days}
              onClick={() => set({ days })}
            >
              {days}
            </button>
          ))}
        </div>
      </div>
      {value.words >= RAMP_MIN_TARGET && (
        <label className={styles.check}>
          <input type="checkbox" checked={value.ramp} onChange={(event) => set({ ramp: event.target.checked })} />
          Разогрев: первая неделя — половина, вторая — три четверти
        </label>
      )}
      <p className={styles.minutes}>
        {formatMinutes(dailyMinutes(value.words, secondsPerExercise))} в день, когда наберутся повторения
      </p>
    </div>
  );
}
