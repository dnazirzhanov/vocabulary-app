/**
 * Deleting my own deck: last on its page and in its editor, red-outlined, and it always asks
 * first, with Cancel focused so a reflexive Enter never deletes. A deck this device keeps is
 * deleted here and the deletion sent with the rest (offline too); otherwise on the server.
 */
import { useState } from 'react';
import { t } from '../i18n/index.ts';
import { api, describeError } from '../lib/api.ts';
import { deleteDeck } from '../local/myDecks.ts';
import { localDb } from '../local/session.ts';
import { syncSoon } from '../local/sync.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { AlertIcon, TrashIcon } from '../ui/icons.tsx';
import styles from './DeleteDeck.module.css';

interface Props {
  deckId: string;
  title: string;
  wordCount: number;
  /** The groups it is given to: they lose it too. */
  groups: { name: string }[];
  onDeleted: () => void;
}

export function DeleteDeck({ deckId, title, wordCount, groups, onDeleted }: Props) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const local = localDb();
      if (local && (await local.get('decks', deckId))) {
        await deleteDeck(local, deckId);
        syncSoon();
      } else await api.deleteDeck(deckId);
      setAsking(false);
      onDeleted();
    } catch (problem) {
      setError(describeError(problem));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className={styles.danger} aria-labelledby="delete-deck-title">
        <h2 id="delete-deck-title" className={styles.title}>
          {t.deleteDeck}
        </h2>
        <p className={styles.note}>{t.theCardsAndTheirProgressWill}</p>
        <button type="button" className={styles.dangerButton} onClick={() => setAsking(true)}>
          <TrashIcon aria-hidden="true" /> {t.deleteDeck}
        </button>
      </section>
      <Dialog open={asking} onClose={() => setAsking(false)} title={t.deleteTheDeck(title)}>
        <div className={styles.confirm}>
          <p>{wordCount > 0 ? t.deckWordsWillBeDeleted(wordCount) : t.theDeckWillBeDeletedFor}</p>
          {groups.length > 0 && (
            <p className={styles.warning}>
              <AlertIcon aria-hidden="true" />
              {t.deckIsGivenWarning(groups.length, groups.map((group) => t.quoted(group.name)).join(', '))}
            </p>
          )}
          <div className={styles.actions}>
            <button type="button" className={styles.cancel} data-autofocus onClick={() => setAsking(false)}>
              {t.cancel}
            </button>
            <button
              type="button"
              className={styles.dangerSolid}
              disabled={busy}
              aria-busy={busy}
              onClick={() => void remove()}
            >
              {busy ? t.deleting : t.deleteDeck}
            </button>
          </div>
          {error && (
            <p className={styles.problem} role="alert">
              {error}
            </p>
          )}
        </div>
      </Dialog>
    </>
  );
}
