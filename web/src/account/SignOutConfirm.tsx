import { useState, type ReactNode } from 'react';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { SecondaryButton } from '../ui/SecondaryButton.tsx';
import { waiting } from '../local/myDecks.ts';
import { localDb } from '../local/session.ts';
import styles from './SignOutConfirm.module.css';
import { t } from '../i18n/index.ts';

/**
 * «Выйти» asks first: one tap by accident should not sign anyone out. «Остаться» is the main
 * button and takes the focus, so a reflexive Enter changes nothing. `children` draws the button
 * that opens the question, in its own place's style.
 */
export function SignOutConfirm({
  onSignOut,
  children,
}: {
  onSignOut: () => Promise<void>;
  children: (ask: () => void) => ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  // Changes made on this device and not sent: said, so nobody signs out unaware (ADR 0061).
  const [unsent, setUnsent] = useState(0);
  const { run, busy, error } = useAsyncAction();
  const ask = () => {
    setAsking(true);
    const db = localDb();
    if (db) void waiting(db).then(setUnsent, () => setUnsent(0));
  };

  return (
    <>
      {children(ask)}
      <Dialog open={asking} onClose={() => setAsking(false)} title={t.signOutQuestion}>
        <p className={styles.note}>{t.signOutNote}</p>
        {unsent > 0 && <p className={styles.problem}>{t.unsentOnSignOut(unsent)}</p>}
        {error && (
          <p className={styles.problem} role="alert">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <PrimaryButton type="button" data-autofocus onClick={() => setAsking(false)}>
            {t.stay}
          </PrimaryButton>
          <SecondaryButton type="button" disabled={busy} aria-busy={busy} onClick={() => void run(onSignOut)}>
            {busy ? t.signingOut : t.signOut}
          </SecondaryButton>
        </div>
      </Dialog>
    </>
  );
}
