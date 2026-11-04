import { useState } from 'react';
import styles from './AuthScreen.module.css';

interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'new-password' | 'current-password';
  hint?: string;
}

/** A password with «Показать»: there is no second field to catch a typo on a phone's keyboard. */
export function PasswordField({ label, value, onChange, autoComplete, hint }: PasswordFieldProps) {
  const [shown, setShown] = useState(false);
  return (
    <div className={styles.field}>
      <label htmlFor={`password-${autoComplete}`}>{label}</label>
      <div className={styles.passwordRow}>
        <input
          id={`password-${autoComplete}`}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={72}
        />
        <button type="button" className={styles.reveal} onClick={() => setShown(!shown)}>
          {shown ? 'Скрыть' : 'Показать'}
        </button>
      </div>
      {hint && <small>{hint}</small>}
    </div>
  );
}
