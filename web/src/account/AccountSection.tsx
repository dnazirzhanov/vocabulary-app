import { useState } from 'react';
import { PasswordField } from '../auth/PasswordField.tsx';
import { api } from '../lib/api.ts';
import { checkPassword } from '../lib/auth.ts';
import { setSoundsOn, soundsOn } from '../lib/sounds.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { SecondaryButton } from '../ui/SecondaryButton.tsx';
import { Reminders } from './Reminders.tsx';
import styles from './AccountSection.module.css';
import { t } from '../i18n/index.ts';

export interface AccountProps {
  email: string | null;
  onSignOut?: () => Promise<void>;
  onAccountDeleted: () => void;
}

/**
 * Sounds, notifications, sign-out and deleting the account, behind ⚙ on every page (ADR 0042). Deleting asks
 * once more in place, with the password where there is one (ADR 0043): it can't be undone, and a
 * phone can be picked up by anyone.
 */
export function AccountSection({ email, onSignOut, onAccountDeleted }: AccountProps) {
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [wrongPassword, setWrongPassword] = useState<string | null>(null);
  const [sounds, setSounds] = useState(soundsOn);
  const { run, busy, error } = useAsyncAction();
  const signOut = useAsyncAction();
  const problem = wrongPassword ?? error;

  const deleteAccount = () =>
    run(async () => {
      setWrongPassword(null);
      if (email) {
        const refused = await checkPassword(email, password);
        if (refused) {
          setWrongPassword(refused);
          return;
        }
      }
      await api.deleteAccount();
      onAccountDeleted();
    });

  return (
    <section aria-label={t.account} className={styles.account}>
      {email && <p className={styles.email}>{email}</p>}
      {!confirming && (
        <>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              role="switch"
              checked={sounds}
              onChange={(event) => {
                setSoundsOn(event.target.checked);
                setSounds(event.target.checked);
              }}
            />
            <span>
              {t.sounds}
              <small>{t.aShortChimeForACorrect}</small>
            </span>
          </label>
          <Reminders />
        </>
      )}
      {confirming ? (
        <div className={styles.confirm} role="group" aria-labelledby="delete-warning">
          <p id="delete-warning">{t.deleteAccountWarning(Boolean(email))}</p>
          {email && (
            <PasswordField
              label={t.yourPassword}
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
            />
          )}
          <div className={styles.confirmActions}>
            <SecondaryButton
              type="button"
              onClick={() => {
                setConfirming(false);
                setPassword('');
                setWrongPassword(null);
              }}
              disabled={busy}
            >
              {t.cancel}
            </SecondaryButton>
            <button
              type="button"
              className={styles.danger}
              disabled={busy || (email !== null && !password)}
              aria-busy={busy}
              onClick={() => void deleteAccount()}
            >
              {busy ? t.deleting : t.yesDelete}
            </button>
          </div>
          {problem && (
            <p className={styles.errorText} role="alert">
              {problem}
            </p>
          )}
        </div>
      ) : (
        <div className={styles.accountActions}>
          {onSignOut && (
            <SecondaryButton
              type="button"
              disabled={signOut.busy}
              aria-busy={signOut.busy}
              onClick={() => void signOut.run(onSignOut)}
            >
              {signOut.busy ? t.signingOut : t.signOut}
            </SecondaryButton>
          )}
          <button type="button" className={styles.dangerLink} onClick={() => setConfirming(true)}>
            {t.deleteAccount}
          </button>
        </div>
      )}
    </section>
  );
}
