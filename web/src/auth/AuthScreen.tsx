import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Illustration } from '../illustrations/index.tsx';
import { describeAuthError, supabase, type AuthFailure } from '../lib/auth.ts';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { PasswordField } from './PasswordField.tsx';
import styles from './AuthScreen.module.css';

/** `confirm` and `recover` are the two steps that ask for the code from an email (ADR 0043). */
type Step = 'signUp' | 'signIn' | 'forgot' | 'confirm' | 'recover';

const TITLES: Record<Step, string> = {
  signUp: 'Создайте аккаунт',
  signIn: 'С возвращением',
  forgot: 'Забыли пароль?',
  confirm: 'Введите код',
  recover: 'Введите код',
};
const MIN_PASSWORD = 8;
const RESEND_SECONDS = 60;

/** Runs a Supabase call and keeps what the learner should see of it. */
function useAuthCall() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The failure's code, or null if it went through. */
  const call = async (
    action: () => Promise<{ error: AuthFailure | null }>,
  ): Promise<{ failed: boolean; code?: string }> => {
    setBusy(true);
    setError(null);
    try {
      const { error: failure } = await action();
      if (failure) setError(describeAuthError(failure));
      return { failed: Boolean(failure), code: failure?.code };
    } catch {
      setError(describeAuthError(null));
      return { failed: true };
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, call };
}

function AuthLayout({ children, onSubmit }: { children: ReactNode; onSubmit: (event: FormEvent) => void }) {
  return (
    <main className={styles.screen}>
      <div className={styles.layout}>
        <div className={styles.stage} aria-hidden="true">
          <Illustration id="key" className={styles.art} />
        </div>
        <form className={styles.form} onSubmit={onSubmit} noValidate>
          {children}
        </form>
      </div>
    </main>
  );
}

/**
 * Email and password only: the least personal data that still lets a learner come back. Everything
 * an email is needed for uses a code typed here, not a link (ADR 0043): a link would open in
 * Safari, outside an installed app, and lose a pending group invite.
 */
export function AuthScreen({ invited = false }: { invited?: boolean }) {
  const [step, setStep] = useState<Step>('signUp');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const { busy, error, setError, call } = useAuthCall();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), [step]);
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn(resendIn - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const address = email.trim();
  const goTo = (next: Step) => {
    setStep(next);
    setError(null);
    setCode('');
    if (next === 'confirm' || next === 'recover') setResendIn(RESEND_SECONDS);
  };
  const sendRecovery = () => supabase!.auth.resetPasswordForEmail(address);
  const sendConfirmation = () => supabase!.auth.resend({ type: 'signup', email: address });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !supabase) return;
    if (step === 'signUp') {
      let session = false;
      const { failed } = await call(async () => {
        const result = await supabase!.auth.signUp({ email: address, password });
        session = Boolean(result.data.session);
        return result;
      });
      // With a session the app has already opened; without one, the email's code comes next.
      if (!failed && !session) goTo('confirm');
    } else if (step === 'signIn') {
      const { code: failure } = await call(() => supabase!.auth.signInWithPassword({ email: address, password }));
      if (failure === 'email_not_confirmed') {
        const { failed } = await call(sendConfirmation);
        if (!failed) goTo('confirm');
      }
    } else if (step === 'forgot') {
      const { failed } = await call(sendRecovery);
      if (!failed) goTo('recover');
    } else {
      // Signed in from here on; the app takes over, asking for a new password after `recover`.
      await call(() =>
        supabase!.auth.verifyOtp({ email: address, token: code, type: step === 'confirm' ? 'signup' : 'recovery' }),
      );
    }
  };

  const resend = async () => {
    const { failed } = await call(step === 'confirm' ? sendConfirmation : sendRecovery);
    if (!failed) setResendIn(RESEND_SECONDS);
  };

  const heading = (
    <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
      {TITLES[step]}
    </h1>
  );
  const problem = error && (
    <p className={styles.error} role="alert">
      {error}
    </p>
  );

  if (step === 'confirm' || step === 'recover') {
    return (
      <AuthLayout onSubmit={submit}>
        {heading}
        <p className={styles.lead}>
          {step === 'confirm'
            ? `Мы отправили код на ${address}.`
            : `Если такой аккаунт есть, мы отправили код на ${address}.`}
        </p>
        <label className={styles.field}>
          <span>Код из письма</span>
          <input
            className={styles.code}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={10}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
          />
        </label>
        {problem}
        <PrimaryButton type="submit" disabled={busy || code.length < 6} aria-busy={busy}>
          {busy ? 'Подождите…' : 'Подтвердить'}
        </PrimaryButton>
        <p className={styles.note}>Письма нет? Проверьте папку «Спам».</p>
        <p className={styles.switch}>
          <button type="button" disabled={busy || resendIn > 0} onClick={() => void resend()}>
            {resendIn > 0 ? `Отправить ещё раз через ${resendIn} с` : 'Отправить ещё раз'}
          </button>
        </p>
        <p className={styles.switch}>
          {step === 'confirm' && 'Уже есть аккаунт? '}
          <button type="button" onClick={() => goTo('signIn')}>
            {step === 'confirm' ? 'Войти' : 'Вернуться ко входу'}
          </button>
        </p>
      </AuthLayout>
    );
  }

  const emailField = (
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
  );

  if (step === 'forgot') {
    return (
      <AuthLayout onSubmit={submit}>
        {heading}
        <p className={styles.lead}>Укажите e-mail аккаунта, и мы пришлём код, чтобы задать новый пароль.</p>
        {emailField}
        {problem}
        <PrimaryButton type="submit" disabled={busy || !address} aria-busy={busy}>
          {busy ? 'Подождите…' : 'Прислать код'}
        </PrimaryButton>
        <p className={styles.switch}>
          <button type="button" onClick={() => goTo('signIn')}>
            Вернуться ко входу
          </button>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout onSubmit={submit}>
      {heading}
      {invited && (
        <p className={styles.invited}>Вас пригласили в группу. Войдите или создайте аккаунт, чтобы вступить.</p>
      )}
      <p className={styles.lead}>
        {step === 'signUp'
          ? 'Чтобы прогресс сохранялся на любом устройстве.'
          : 'Войдите, чтобы продолжить с того же места.'}
      </p>
      {emailField}
      <PasswordField
        label="Пароль"
        value={password}
        onChange={setPassword}
        autoComplete={step === 'signUp' ? 'new-password' : 'current-password'}
        hint={step === 'signUp' ? 'Не короче 8 символов.' : undefined}
      />
      {problem}
      <PrimaryButton type="submit" disabled={busy || !address || password.length < MIN_PASSWORD} aria-busy={busy}>
        {busy ? 'Подождите…' : step === 'signUp' ? 'Создать аккаунт' : 'Войти'}
      </PrimaryButton>
      <p className={styles.switch}>
        {step === 'signUp' ? 'Уже есть аккаунт?' : 'Ещё нет аккаунта?'}{' '}
        <button type="button" onClick={() => goTo(step === 'signUp' ? 'signIn' : 'signUp')}>
          {step === 'signUp' ? 'Войти' : 'Создать'}
        </button>
      </p>
      {step === 'signIn' && (
        <p className={styles.switch}>
          <button type="button" onClick={() => goTo('forgot')}>
            Забыли пароль?
          </button>
        </p>
      )}
      <p className={styles.note}>Мы храним только ваш e-mail и прогресс обучения.</p>
    </AuthLayout>
  );
}

/** After a recovery code: the session exists, but the app waits until the new password is saved. */
export function NewPasswordScreen({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const { busy, error, call } = useAuthCall();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !supabase) return;
    const { failed } = await call(() => supabase!.auth.updateUser({ password }));
    if (failed) return;
    // Whoever knew the old password is out of the other devices now; this one stays in.
    await supabase.auth.signOut({ scope: 'others' }).catch(() => undefined);
    onDone();
  };

  return (
    <AuthLayout onSubmit={submit}>
      <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
        Новый пароль
      </h1>
      <p className={styles.lead}>На других устройствах нужно будет войти заново.</p>
      <PasswordField
        label="Новый пароль"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        hint="Не короче 8 символов."
      />
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <PrimaryButton type="submit" disabled={busy || password.length < MIN_PASSWORD} aria-busy={busy}>
        {busy ? 'Подождите…' : 'Сохранить пароль'}
      </PrimaryButton>
    </AuthLayout>
  );
}
