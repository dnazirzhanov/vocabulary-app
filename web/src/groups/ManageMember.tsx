import { useState } from 'react';
import { api } from '../lib/api.ts';
import type { BoardRow, Group } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { SecondaryButton } from '../ui/SecondaryButton.tsx';
import shared from './Groups.module.css';
import styles from './Group.module.css';
import { t } from '../i18n/index.ts';

/**
 * What the group's managers may do with one person, in that person's window (ADR 0040): hand the
 * group over, or remove them. Each asks once. Nothing is shown to someone who may do neither, and
 * nobody manages themselves (they leave instead).
 */
export function ManageMember({ group, row, onDone }: { group: Group; row: BoardRow; onDone: () => void }) {
  const [ask, setAsk] = useState<'owner' | 'remove' | null>(null);
  const { run, busy, error } = useAsyncAction();
  const canHandOver = group.can.includes('transfer_ownership');
  const canRemove = group.can.includes('remove_member');
  if (row.is_me || (!canHandOver && !canRemove)) return null;

  const act = (action: () => Promise<unknown>) =>
    run(async () => {
      await action();
      onDone();
    });

  return (
    <section aria-labelledby="manage-title" className={styles.manageMember}>
      <h3 id="manage-title" className={styles.blockTitle}>
        {t.manage}
      </h3>
      {ask === null ? (
        <div className={styles.manageActions}>
          {canHandOver && (
            <button type="button" className={shared.linkButton} onClick={() => setAsk('owner')}>
              {t.makeOwner}
            </button>
          )}
          {canRemove && (
            <button type="button" className={styles.dangerLink} onClick={() => setAsk('remove')}>
              {t.removeMember}
            </button>
          )}
        </div>
      ) : (
        <div className={styles.manageConfirm}>
          <p>{ask === 'owner' ? t.handTheGroupOverToYou(row.name) : t.removeFromTheGroupTheyCan(row.name)}</p>
          <span className={shared.confirm}>
            <button
              type="button"
              className={shared.dangerButton}
              disabled={busy}
              onClick={() =>
                void act(() =>
                  ask === 'owner'
                    ? api.transferOwnership(group.id, row.member_id)
                    : api.removeMember(group.id, row.member_id),
                )
              }
            >
              {ask === 'owner' ? t.yesHandOver : t.yesDelete}
            </button>
            <SecondaryButton
              type="button"
              className={shared.smallSecondary}
              onClick={() => setAsk(null)}
              data-autofocus
            >
              {t.cancel}
            </SecondaryButton>
          </span>
        </div>
      )}
      {error && (
        <p className={shared.problem} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
