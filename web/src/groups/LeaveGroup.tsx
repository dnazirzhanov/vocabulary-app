import { useState } from 'react';
import { api } from '../lib/api.ts';
import type { Board } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { SecondaryButton } from '../ui/SecondaryButton.tsx';
import shared from './Groups.module.css';
import styles from './Group.module.css';
import { t } from '../i18n/index.ts';

/**
 * «Выйти из группы» (ADR 0040): a quiet link at the bottom of the page for everyone, never folded
 * away. A member confirms once. The owner, with others still in the group, first names who takes
 * it over; alone, they are told the group will go with them.
 */
export function LeaveGroup({ board, onLeft }: { board: Board; onLeft: () => void }) {
  const { group } = board;
  const owner = group.can.includes('transfer_ownership');
  const others = board.rows.filter((row) => !row.is_me);
  const [step, setStep] = useState<'idle' | 'confirm' | 'successor'>('idle');
  const [successor, setSuccessor] = useState<string | null>(null);
  const { run, busy, error } = useAsyncAction();
  const leave = (successorId?: string) =>
    run(async () => {
      await api.leaveGroup(group.id, successorId);
      onLeft();
    });

  return (
    <div className={styles.leave}>
      {step === 'confirm' ? (
        <span className={shared.confirm}>
          {owner ? t.aloneLeaveQuestion : t.leaveTheGroup}
          <button type="button" className={shared.dangerButton} disabled={busy} onClick={() => void leave()}>
            {t.yesLeave}
          </button>
          <SecondaryButton
            type="button"
            className={shared.smallSecondary}
            onClick={() => setStep('idle')}
            data-autofocus
          >
            {t.cancel}
          </SecondaryButton>
        </span>
      ) : (
        <button
          type="button"
          className={styles.leaveLink}
          onClick={() => setStep(owner && others.length > 0 ? 'successor' : 'confirm')}
        >
          {t.leaveGroupAction}
        </button>
      )}
      {error && step !== 'successor' && (
        <p className={shared.problem} role="alert">
          {error}
        </p>
      )}
      <Dialog open={step === 'successor'} onClose={() => setStep('idle')} title={t.whoShouldTakeOverTheGroup}>
        <p className={styles.dialogText}>{t.youLlLeaveTheGroupAnd}</p>
        <fieldset className={styles.successors}>
          <legend className="visually-hidden">{t.theGroupSNewOwner}</legend>
          {others.map((row) => (
            <label key={row.member_id} className={styles.successor} data-selected={successor === row.member_id}>
              <input
                type="radio"
                name="successor"
                checked={successor === row.member_id}
                onChange={() => setSuccessor(row.member_id)}
              />
              {row.nickname}
            </label>
          ))}
        </fieldset>
        {error && (
          <p className={shared.problem} role="alert">
            {error}
          </p>
        )}
        <PrimaryButton type="button" disabled={busy || !successor} onClick={() => successor && void leave(successor)}>
          {t.handOverAndLeave}
        </PrimaryButton>
      </Dialog>
    </div>
  );
}
