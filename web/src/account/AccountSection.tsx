import { useState } from 'react';
import { api } from '../lib/api.ts';
import { setSoundsOn, soundsOn } from '../lib/sounds.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { SecondaryButton } from '../ui/SecondaryButton.tsx';
import { Reminders } from './Reminders.tsx';
import styles from './AccountSection.module.css';

export interface AccountProps {
  email: string | null;
  onSignOut?: () => void;
  onAccountDeleted: () => void;
}

/** Sounds, reminders, sign-out and deleting your data, in «Прогресс» → ⚙ (ADR 0034); deletion asks once more in place instead of a browser dialog. */
export function AccountSection({ email, onSignOut, onAccountDeleted }: AccountProps) {
  const [confirming, setConfirming] = useState(false);
  const [sounds, setSounds] = useState(soundsOn);
  const { run, busy, error } = useAsyncAction();
  return (
    <section aria-label="Аккаунт" className={styles.account}>
      {email && <p className={styles.email}>{email}</p>}
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
          Звуки
          <small>Короткий звон за верное слово и мелодия в конце урока</small>
        </span>
      </label>
      <Reminders />
      {confirming ? (
        <div className={styles.confirm} role="group" aria-labelledby="delete-warning">
          <p id="delete-warning">
            Все слова, повторения и результаты будут удалены, восстановить их будет нельзя.
            {email && ' Чтобы удалить и e-mail для входа, напишите организатору.'}
          </p>
          <div className={styles.confirmActions}>
            <SecondaryButton type="button" onClick={() => setConfirming(false)} disabled={busy}>
              Отмена
            </SecondaryButton>
            <button
              type="button"
              className={styles.danger}
              disabled={busy}
              aria-busy={busy}
              onClick={() =>
                run(async () => {
                  await api.deleteAccount();
                  onAccountDeleted();
                })
              }
            >
              {busy ? 'Удаляем…' : 'Да, удалить'}
            </button>
          </div>
          {error && (
            <p className={styles.errorText} role="alert">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className={styles.accountActions}>
          {onSignOut && (
            <SecondaryButton type="button" onClick={onSignOut}>
              Выйти
            </SecondaryButton>
          )}
          <button type="button" className={styles.dangerLink} onClick={() => setConfirming(true)}>
            Удалить мой прогресс
          </button>
        </div>
      )}
    </section>
  );
}
