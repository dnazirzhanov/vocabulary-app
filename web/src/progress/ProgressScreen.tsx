import { useCallback, useEffect, useRef, useState } from 'react';
import { api, describeError } from '../lib/api.ts';
import type { Progress } from '../lib/types.ts';
import { courseOf, goalWordsOf } from '../lib/course.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { SecondaryButton } from '../ui/SecondaryButton.tsx';
import { Consistency } from './Consistency.tsx';
import { WordsFigure } from './WordsFigure.tsx';
import styles from './ProgressScreen.module.css';

interface AccountProps {
  email: string | null;
  onSignOut?: () => void;
  onAccountDeleted: () => void;
}

/** Sign-out and deleting your data; deletion asks once more in place instead of a browser dialog. */
function AccountSection({ email, onSignOut, onAccountDeleted }: AccountProps) {
  const [confirming, setConfirming] = useState(false);
  const { run, busy, error } = useAsyncAction();
  return (
    <section aria-labelledby="account-heading" className={styles.account}>
      <h2 id="account-heading" className={styles.sectionTitle}>
        Аккаунт
      </h2>
      {email && <p className={styles.email}>{email}</p>}
      {confirming ? (
        <div className={styles.confirm} role="group" aria-labelledby="delete-warning">
          <p id="delete-warning">
            Все слова, повторения и очки будут удалены, восстановить их будет нельзя.
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

/** Two questions, answered at a glance: how far along the words are, and how steadily they are practised. */
export function ProgressScreen(account: AccountProps) {
  const [loaded, setLoaded] = useState<{ progress: Progress; goalWords: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(
    () =>
      Promise.all([api.progress(), api.listDecks()]).then(
        ([progress, decks]) => setLoaded({ progress, goalWords: goalWordsOf(courseOf(decks)) }),
        (caught: unknown) => setError(describeError(caught)),
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => headingRef.current?.focus(), [loaded]);

  if (error) {
    return (
      <div className={styles.screen}>
        <main className={styles.message}>
          <p role="alert">{error}</p>
          <PrimaryButton
            type="button"
            onClick={() => {
              setError(null);
              void load();
            }}
          >
            Повторить
          </PrimaryButton>
        </main>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className={styles.screen}>
        <main className={styles.message} aria-busy="true">
          <p>Загружаем…</p>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <main className={styles.main}>
        <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
          Прогресс
        </h1>
        <WordsFigure progress={loaded.progress} goalWords={loaded.goalWords} />
        <Consistency progress={loaded.progress} />
        <AccountSection {...account} />
      </main>
    </div>
  );
}
