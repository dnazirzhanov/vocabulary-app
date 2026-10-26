import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Illustration } from '../illustrations/index.tsx';
import { describeAuthError, supabase } from '../lib/auth.ts';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './AuthScreen.module.css';

type Mode = 'signIn' | 'signUp';

/** Email and password only: the least personal data that still lets a learner come back. */
export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signUp');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), [mode]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !supabase) return;
    setBusy(true);
    setError(null);
    try {
      const credentials = { email: email.trim(), password };
      const { error: failure } =
        mode === 'signUp'
          ? await supabase.auth.signUp(credentials)
          : await supabase.auth.signInWithPassword(credentials);
      if (failure) setError(describeAuthError(failure));
    } catch {
      setError(describeAuthError(null));
    } finally {
      setBusy(false);
    }
  };

  const switchTo = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  return (
    <main className={styles.screen}>
      <div className={styles.layout}>
        <div className={styles.stage} aria-hidden="true">
          <Illustration id="key" className={styles.art} />
        </div>
        <form className={styles.form} onSubmit={submit} noValidate>
          <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
            {mode === 'signUp' ? 'Создайте аккаунт' : 'С возвращением'}
          </h1>
          <p className={styles.lead}>
            {mode === 'signUp'
              ? 'Чтобы прогресс сохранялся на любом устройстве.'
              : 'Войдите, чтобы продолжить с того же места.'}
          </p>

          <label className={styles.field}>
            <span>E-mail</span>
            <input
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              maxLength={254}
            />
          </label>
          <label className={styles.field}>
            <span>Пароль</span>
            <input
              type="password"
              autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              maxLength={72}
            />
            {mode === 'signUp' && <small>Не короче 8 символов.</small>}
          </label>

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}

          <PrimaryButton type="submit" disabled={busy || !email || password.length < 8} aria-busy={busy}>
            {busy ? 'Подождите…' : mode === 'signUp' ? 'Создать аккаунт' : 'Войти'}
          </PrimaryButton>

          <p className={styles.switch}>
            {mode === 'signUp' ? 'Уже есть аккаунт?' : 'Ещё нет аккаунта?'}{' '}
            <button type="button" onClick={() => switchTo(mode === 'signUp' ? 'signIn' : 'signUp')}>
              {mode === 'signUp' ? 'Войти' : 'Создать'}
            </button>
          </p>
          {mode === 'signIn' && <p className={styles.note}>Забыли пароль? Напишите организатору — он поможет.</p>}
          <p className={styles.note}>Мы храним только ваш e-mail и прогресс обучения.</p>
        </form>
      </div>
    </main>
  );
}
