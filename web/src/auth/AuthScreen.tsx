import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Illustration } from '../illustrations/index.tsx';
import { describeAuthError, supabase, type AuthFailure } from '../lib/auth.ts';
import { suggestEmail } from '../lib/emailTypo.ts';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { PasswordField, useRepeatedPassword } from './PasswordField.tsx';
import styles from './AuthScreen.module.css';
import { switchLanguage, t, uiLanguage } from '../i18n/index.ts';
import { UI_LANGUAGES } from '../i18n/languages.ts';
import { LanguageSelect } from '../ui/LanguageSelect.tsx';

/** `confirm` and `recover` are the two steps that ask for the code from an email (ADR 0043). */
type Step = 'signUp' | 'signIn' | 'forgot' | 'confirm' | 'recover';

const TITLES: Record<Step, string> = {
  signUp: t.createAnAccount,
  signIn: t.signIn,
  forgot: t.forgotYourPassword,
  confirm: t.enterTheCode,
  recover: t.enterTheCode,
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
      {/* First, and needing no reading: someone who can't read this page has to find it. In the
        corner, where ⚙ is on every other page; out of the layout, which stays stage and form. */}
      <div className={styles.language}>
        <LanguageSelect label={t.appLanguage} value={uiLanguage} options={UI_LANGUAGES} onChoose={switchLanguage} />
      </div>
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
  const [step, setStep] = useState<Step>('signIn');
  const [email, setEmail] = useState('');
  const { password, setPassword, repeat, setRepeat, onLeave, matches, mismatch } = useRepeatedPassword();
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);
  // An address that looks like a slip («…@gamil.com»), stopped before a code is sent to it, and
  // the one the person said is right after all.
  const [checking, setChecking] = useState(false);
  const [rightAfterAll, setRightAfterAll] = useState<string | null>(null);
  const { busy, error, setError, call } = useAuthCall();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), [step]);
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn(resendIn - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const address = email.trim();
  const suggested = suggestEmail(email);
  const goTo = (next: Step) => {
    setStep(next);
    setError(null);
    setCode('');
    setRepeat('');
    if (next === 'confirm' || next === 'recover') setResendIn(RESEND_SECONDS);
  };
  const sendRecovery = () => supabase!.auth.resetPasswordForEmail(address);
  const sendConfirmation = () => supabase!.auth.resend({ type: 'signup', email: address });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !supabase) return;
    // A code sent to a mistyped address never arrives, and nothing tells the app: ask once first.
    if ((step === 'signUp' || step === 'forgot') && suggestEmail(address) && rightAfterAll !== address) {
      setChecking(true);
      return;
    }
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
          {step === 'confirm' ? t.weSentACodeTo(address) : t.ifThatAccountExistsWeSent(address)}
        </p>
        {/* The code went to this address: one that looks mistyped is said again, and changing it is
            one tap back, the address kept to correct. */}
        {suggested && <p className={styles.check}>{t.didYouMean(suggested)}</p>}
        <p className={styles.switch}>
          {t.wrongAddress}
          <button type="button" onClick={() => goTo(step === 'confirm' ? 'signUp' : 'forgot')}>
            {t.edit}
          </button>
        </p>
        <label className={styles.field}>
          <span>{t.codeFromTheEmail}</span>
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
          {busy ? t.pleaseWait : t.confirm}
        </PrimaryButton>
        <p className={styles.note}>{t.noEmailCheckYourSpamFolder}</p>
        <p className={styles.switch}>
          <button type="button" disabled={busy || resendIn > 0} onClick={() => void resend()}>
            {resendIn > 0 ? t.sendAgainInS(resendIn) : t.sendAgain}
          </button>
        </p>
        <p className={styles.switch}>
          {step === 'confirm' && t.alreadyHaveAnAccount}
          <button type="button" onClick={() => goTo('signIn')}>
            {step === 'confirm' ? t.signInNow : t.backToSignIn}
          </button>
        </p>
      </AuthLayout>
    );
  }

  // Stopped before sending: the address and its likely fix, side by side, with both answers.
  const addressCheck = checking && suggested && (
    <div className={styles.check} role="alert">
      <p>{t.checkTheAddress(address)}</p>
      <button type="button" className={styles.checkFix} onClick={() => (setEmail(suggested), setChecking(false))}>
        {t.fixTo(suggested)}
      </button>
      <button
        type="button"
        className={styles.checkKeep}
        onClick={() => (setRightAfterAll(address), setChecking(false))}
      >
        {t.addressIsRight}
      </button>
    </div>
  );
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
        aria-describedby={suggested ? 'email-suggestion' : undefined}
      />
      {/* A slip in the domain («gamil.com»): the code would go nowhere, so the fix is one tap. */}
      {suggested && !checking && (
        <button id="email-suggestion" type="button" className={styles.suggestion} onClick={() => setEmail(suggested)}>
          {t.didYouMean(suggested)}
        </button>
      )}
    </label>
  );

  if (step === 'forgot') {
    return (
      <AuthLayout onSubmit={submit}>
        {heading}
        <p className={styles.lead}>{t.enterYourAccountSEmailAnd}</p>
        {emailField}
        {addressCheck}
        {problem}
        <PrimaryButton type="submit" disabled={busy || !address} aria-busy={busy}>
          {busy ? t.pleaseWait : t.sendCode}
        </PrimaryButton>
        <p className={styles.switch}>
          <button type="button" onClick={() => goTo('signIn')}>
            {t.backToSignIn}
          </button>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout onSubmit={submit}>
      {heading}
      {invited && <p className={styles.invited}>{t.youVeBeenInvitedToA}</p>}
      {step === 'signUp' && <p className={styles.lead}>{t.soYourProgressIsSavedOn}</p>}
      {emailField}
      {addressCheck}
      <PasswordField
        label={t.password}
        value={password}
        onChange={setPassword}
        autoComplete={step === 'signUp' ? 'new-password' : 'current-password'}
        hint={step === 'signUp' ? t.atLeast8Characters : undefined}
      />
      {step === 'signUp' && (
        <PasswordField
          label={t.repeatThePassword}
          value={repeat}
          onChange={setRepeat}
          onBlur={onLeave}
          autoComplete="new-password"
          problem={mismatch}
        />
      )}
      {problem}
      <PrimaryButton
        type="submit"
        disabled={busy || !address || password.length < MIN_PASSWORD || (step === 'signUp' && !matches)}
        aria-busy={busy}
      >
        {busy ? t.pleaseWait : step === 'signUp' ? t.createAccount : t.signInNow}
      </PrimaryButton>
      <p className={styles.switch}>
        {step === 'signUp' ? t.alreadyHaveAccountQuestion : t.noAccountYet}{' '}
        <button type="button" onClick={() => goTo(step === 'signUp' ? 'signIn' : 'signUp')}>
          {step === 'signUp' ? t.signInNow : t.create}
        </button>
      </p>
      {step === 'signIn' && (
        <p className={styles.switch}>
          <button type="button" onClick={() => goTo('forgot')}>
            {t.forgotYourPassword}
          </button>
        </p>
      )}
      {step === 'signUp' && <p className={styles.note}>{t.weOnlyStoreYourEmailAnd}</p>}
    </AuthLayout>
  );
}

/** After a recovery code: the session exists, but the app waits until the new password is saved. */
export function NewPasswordScreen({ onDone }: { onDone: () => void }) {
  const { password, setPassword, repeat, setRepeat, onLeave, matches, mismatch } = useRepeatedPassword();
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
        {t.newPassword}
      </h1>
      <p className={styles.lead}>{t.youLlNeedToSignIn}</p>
      <PasswordField
        label={t.newPassword}
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        hint={t.atLeast8Characters}
      />
      <PasswordField
        label={t.repeatThePassword}
        value={repeat}
        onChange={setRepeat}
        onBlur={onLeave}
        autoComplete="new-password"
        problem={mismatch}
      />
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <PrimaryButton type="submit" disabled={busy || password.length < MIN_PASSWORD || !matches} aria-busy={busy}>
        {busy ? t.pleaseWait : t.savePassword}
      </PrimaryButton>
    </AuthLayout>
  );
}
