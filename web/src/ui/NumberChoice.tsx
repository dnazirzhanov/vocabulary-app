import { useId, useState } from 'react';
import styles from './NumberChoice.module.css';
import { t } from '../i18n/index.ts';

/**
 * How many: the usual numbers and one's own, in one control (as a phone's segmented picker). The
 * last segment is a number field: typing in it chooses it.
 */
export function NumberChoice({
  label,
  value,
  presets,
  max,
  ownLabel,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  presets: readonly number[];
  max: number;
  /** The own number's field, for screen readers («или своё число, до 50»). */
  ownLabel: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const name = useId();
  // What is in the field while it is being typed in (it may equal a preset: 50 of 70 typed).
  const [typed, setTyped] = useState<string | null>(null);
  const own = typed !== null || !presets.includes(value);
  return (
    <fieldset className={styles.choice} disabled={disabled}>
      <legend className={styles.legend}>{label}</legend>
      <div className={styles.segments}>
        {presets.map((preset) => (
          <label key={preset} className={styles.segment} data-selected={(!own && preset === value) || undefined}>
            <input
              type="radio"
              name={name}
              value={preset}
              checked={preset === value}
              onChange={() => onChange(preset)}
            />
            {preset}
          </label>
        ))}
        <input
          className={styles.own}
          data-selected={own || undefined}
          type="number"
          inputMode="numeric"
          min={1}
          max={max}
          placeholder={t.yourOwn}
          aria-label={ownLabel}
          value={typed ?? (own ? value : '')}
          onFocus={() => setTyped(own ? String(value) : '')}
          onBlur={() => setTyped(null)}
          onChange={(event) => {
            const number = Number(event.target.value);
            if (!number) return setTyped(event.target.value);
            const kept = Math.min(max, Math.max(1, number));
            setTyped(String(kept));
            onChange(kept);
          }}
        />
      </div>
    </fieldset>
  );
}
