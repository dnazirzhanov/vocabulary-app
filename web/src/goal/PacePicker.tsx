import { useId } from 'react';
import {
  dailyMinutes,
  formatMinutes,
  MAX_TARGET,
  MIN_TARGET,
  PRESETS,
  presetFor,
  RAMP_MIN_TARGET,
  REALITY_CHECK_TARGET,
  wordsLabel,
} from '../lib/pace.ts';
import { WeekdayPicker } from '../promise/WeekdayPicker.tsx';
import styles from './PacePicker.module.css';

export interface PaceChoice {
  words: number;
  /** The weekdays promised: 0 = Monday … 6 = Sunday (ADR 0039). */
  weekdays: number[];
  ramp: boolean;
}

interface PacePickerProps {
  value: PaceChoice;
  onChange: (value: PaceChoice) => void;
  secondsPerExercise?: number;
}

/** Preset cards named by time, a custom amount, the weekdays promised and the warm-up. */
export function PacePicker({ value, onChange, secondsPerExercise }: PacePickerProps) {
  const id = useId();
  const custom = !presetFor(value.words);
  const minutes = dailyMinutes(value.words, secondsPerExercise);
  const set = (changes: Partial<PaceChoice>) => onChange({ ...value, ...changes });

  return (
    <div className={styles.picker}>
      <fieldset>
        <legend className="visually-hidden">Новых слов в день</legend>
        <div className={styles.presets}>
          {PRESETS.map((preset) => (
            <label key={preset.id} className={styles.preset} data-selected={value.words === preset.words}>
              <input
                type="radio"
                name={`${id}-preset`}
                className={styles.input}
                checked={value.words === preset.words}
                onChange={() => set({ words: preset.words })}
              />
              <span className={styles.presetName}>{preset.name}</span>
              <span className={styles.presetWords}>{wordsLabel(preset.words)}</span>
              <span className={styles.presetTime}>{formatMinutes(dailyMinutes(preset.words, secondsPerExercise))}</span>
            </label>
          ))}
        </div>
        <div className={styles.custom} data-selected={custom}>
          <label htmlFor={`${id}-custom`} className={styles.customLabel}>
            Свой темп: <strong>{wordsLabel(value.words)}</strong> в день
          </label>
          <input
            id={`${id}-custom`}
            type="range"
            className={styles.range}
            min={MIN_TARGET}
            max={MAX_TARGET}
            value={value.words}
            aria-valuetext={`${wordsLabel(value.words)} в день, ${formatMinutes(minutes)}`}
            onChange={(event) => set({ words: Number(event.target.value) })}
          />
          <div className={styles.rangeScale} aria-hidden="true">
            <span>{MIN_TARGET}</span>
            <span>{MAX_TARGET}</span>
          </div>
        </div>
      </fieldset>

      {value.words >= REALITY_CHECK_TARGET && (
        <p className={styles.reality} role="note">
          <strong>Через месяц это {formatMinutes(minutes)} каждый день.</strong> Каждое новое слово потом нужно
          повторить около 5&nbsp;раз, и повторения копятся. Большинство людей переоценивает свободное время — выберите
          темп, который выдержите и в загруженный день.
        </p>
      )}

      {value.words >= RAMP_MIN_TARGET && (
        <label className={styles.check}>
          <input type="checkbox" checked={value.ramp} onChange={(event) => set({ ramp: event.target.checked })} />
          <span>
            <strong>Разогрев</strong>
            <small>
              Первая неделя — половина цели, вторая — три четверти. Так легче втянуться, а дальше полный темп.
            </small>
          </span>
        </label>
      )}

      <fieldset className={styles.days}>
        <legend className={styles.daysLegend}>В какие дни вы обещаете заниматься?</legend>
        <WeekdayPicker value={value.weekdays} onChange={(weekdays) => set({ weekdays })} />
        <p className={styles.hint}>
          Это ваше обещание: оно показано на странице «Прогресс», а друзья из группы увидят, выполнили ли вы его.
          Выходные — это нормально.
        </p>
      </fieldset>
    </div>
  );
}
