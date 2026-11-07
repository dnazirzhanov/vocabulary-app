import { useState } from 'react';
import { CheckIcon, ForwardIcon } from '../ui/icons.tsx';
import styles from './LanguageRow.module.css';

/**
 * A language in settings: one row saying which is chosen, opening its list in place. Each name is
 * written in itself, so it can be read whatever the app's language is now.
 */
export function LanguageRow<Code extends string>(props: {
  label: string;
  value: Code;
  options: Record<Code, string>;
  disabled?: boolean;
  onChoose: (language: Code) => void;
}) {
  const { label, value, options, disabled, onChoose } = props;
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.row}>
      <button type="button" className={styles.head} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{label}</span>
        <span className={styles.value}>
          {options[value]}
          <ForwardIcon className={styles.chevron} data-open={open || undefined} aria-hidden="true" />
        </span>
      </button>
      {open && (
        <div role="radiogroup" aria-label={label} className={styles.list}>
          {(Object.entries(options) as [Code, string][]).map(([code, name]) => (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={code === value}
              className={styles.option}
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                if (code !== value) onChoose(code);
              }}
            >
              {name}
              {code === value && <CheckIcon className={styles.tick} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
