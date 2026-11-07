import { useState } from 'react';
import { api } from '../lib/api.ts';
import { dueLabel } from '../lib/deadline.ts';
import { wordsLabel } from '../lib/pace.ts';
import type { Assignment, Board } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './GroupDecks.module.css';
import { t } from '../i18n/index.ts';

interface GroupDecksProps {
  board: Board;
  /** The author opens their deck in the editor (decks are written in «Мои колоды», ADR 0019). */
  onOpenDeck: (deckId: string) => void;
  onChanged: () => void;
}

/**
 * Decks given to the group, folded under «Управление группой» (ADR 0032): name, size, deadline,
 * and «Изменить» for its author.
 */
export function GroupDecks({ board, onOpenDeck, onChanged }: GroupDecksProps) {
  const owner = board.group.can.includes('give_decks');
  const [removing, setRemoving] = useState<Assignment | null>(null);
  const { run, busy, error } = useAsyncAction();
  if (board.assignments.length === 0) {
    if (!owner) return null;
    return <p className={styles.hint}>{t.noDecksYetCreateOneIn}</p>;
  }
  return (
    <section className={styles.section} aria-labelledby="group-decks-title">
      <h3 id="group-decks-title" className={styles.title}>
        {t.theGroupSDecks}
      </h3>
      <ul className={styles.list}>
        {board.assignments.map((assignment) => (
          <li key={assignment.deck_id} className={styles.item}>
            <span>
              <strong>{assignment.title}</strong>
              <span className={styles.meta}>
                {' '}
                · {wordsLabel(assignment.word_count)}
                {assignment.due_on && t.byDate(dueLabel(assignment.due_on))}
              </span>
            </span>
            <span className={styles.actions}>
              {assignment.is_mine && (
                <button type="button" className={styles.linkButton} onClick={() => onOpenDeck(assignment.deck_id)}>
                  {t.edit}
                </button>
              )}
              {owner && (
                <button
                  type="button"
                  className={styles.linkButton}
                  aria-label={t.removeFromTheGroup(assignment.title)}
                  onClick={() => setRemoving(assignment)}
                >
                  {t.removeAction}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {/* Asked here, unlike in the giving window: gone from this list, it can't be undone in place. */}
      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t.removeQuestion(removing?.title ?? '')}
      >
        <div className={styles.confirm}>
          <p>{t.membersWonTSeeItIn}</p>
          {error && (
            <p className={styles.problem} role="alert">
              {error}
            </p>
          )}
          <PrimaryButton
            type="button"
            disabled={busy}
            aria-busy={busy}
            onClick={() =>
              run(async () => {
                await api.takeBackDeck(board.group.id, removing!.deck_id);
                setRemoving(null);
                onChanged();
              })
            }
          >
            {t.removeDeckFromGroup}
          </PrimaryButton>
          <button type="button" className={styles.linkButton} data-autofocus onClick={() => setRemoving(null)}>
            {t.cancel}
          </button>
        </div>
      </Dialog>
    </section>
  );
}
