import { useState } from 'react';
import { api } from '../lib/api.ts';
import type { Group } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { SecondaryButton } from '../ui/SecondaryButton.tsx';
import shared from './Groups.module.css';
import styles from './Group.module.css';
import { t } from '../i18n/index.ts';

/**
 * «Удалить группу» (ADR 0040), for the owner, folded away with the group's other management. It
 * says what goes and what stays before it asks.
 */
export function DeleteGroup({ group, onDeleted }: { group: Group; onDeleted: () => void }) {
  const [asking, setAsking] = useState(false);
  const { run, busy, error } = useAsyncAction();
  if (!group.can.includes('delete_group')) return null;
  return (
    <div className={styles.deleteGroup}>
      {asking ? (
        <>
          <p>{t.deleteGroupQuestion(group.name)}</p>
          <span className={shared.confirm}>
            <button
              type="button"
              className={shared.dangerButton}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api.deleteGroup(group.id);
                  onDeleted();
                })
              }
            >
              {t.yesDelete}
            </button>
            <SecondaryButton
              type="button"
              className={shared.smallSecondary}
              onClick={() => setAsking(false)}
              data-autofocus
            >
              {t.cancel}
            </SecondaryButton>
          </span>
        </>
      ) : (
        <button type="button" className={styles.dangerLink} onClick={() => setAsking(true)}>
          {t.deleteGroup}
        </button>
      )}
      {error && (
        <p className={shared.problem} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
