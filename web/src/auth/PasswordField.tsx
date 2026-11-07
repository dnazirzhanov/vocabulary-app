import { useId, useState } from 'react';
import styles from './AuthScreen.module.css';
import { t } from '../i18n/index.ts';

interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'new-password' | 'current-password';
  hint?: string;
  problem?: string | null;
  onBlur?: () => void;
}

/** A password with «Показать», for checking what a phone's keyboard really typed. */
export function PasswordField({ label, value, onChange, autoComplete, hint, problem, onBlur }: PasswordFieldProps) {
  const [shown, setShown] = useState(false);
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.passwordRow}>
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          maxLength={72}
        />
        <button type="button" className={styles.reveal} onClick={() => setShown(!shown)}>
          {shown ? t.hide : t.show}
        </button>
      </div>
      {hint && <small>{hint}</small>}
      {problem && (
        <p className={styles.error} role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/** A new password typed twice: says so if they differ only once the second is finished. */
export function useRepeatedPassword() {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [left, setLeft] = useState(false);
  const finished = left || repeat.length >= password.length;
  return {
    password,
    setPassword,
    repeat,
    setRepeat: (value: string) => {
      setRepeat(value);
      setLeft(false);
    },
    onLeave: () => setLeft(true),
    matches: password === repeat,
    mismatch: repeat !== '' && repeat !== password && finished ? t.thePasswordsDonTMatch : null,
  };
}
