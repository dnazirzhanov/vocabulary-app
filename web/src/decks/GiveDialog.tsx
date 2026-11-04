import { useEffect, useState, type FormEvent } from 'react';
import { api, describeError } from '../lib/api.ts';
import { dueLabel, localToday } from '../lib/deadline.ts';
import type { Group, TeacherDeck } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { CheckIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './GiveDialog.module.css';

/**
 * «Дать группе» in a window (ADR 0036): which of my groups get this deck, and by when it should be
 * learned (ADR 0028). It loads the deck and my groups itself, so the deck editor and a deck's own
 * page open it the same way, and tells its opener whenever the deck changes.
 */
export function GiveDialog({
  deckId,
  onClose,
  onChanged,
}: {
  deckId: string;
  onClose: () => void;
  onChanged?: (deck: TeacherDeck) => void;
}) {
  const [deck, setDeck] = useState<TeacherDeck | null>(null);
  const [owned, setOwned] = useState<Group[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [giveTo, setGiveTo] = useState('');
  const [due, setDue] = useState('');
  const { run, busy, error } = useAsyncAction();

  useEffect(() => {
    Promise.all([api.teacherDeck(deckId), api.groups()]).then(
      ([loaded, groups]) => {
        setDeck(loaded);
        setOwned(groups.filter((group) => group.can.includes('give_decks')));
      },
      (caught: unknown) => setLoadError(describeError(caught)),
    );
  }, [deckId]);

  const show = (next: TeacherDeck) => {
    setDeck(next);
    onChanged?.(next);
  };
  const given = new Set(deck?.groups.map((group) => group.id));
  // Groups that haven't got it (a deck taken back is offered again).
  const free = (owned ?? []).filter((group) => !given.has(group.id));
  const chosen = free.some((group) => group.id === giveTo) ? giveTo : (free[0]?.id ?? '');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!chosen) return;
    void run(async () => {
      show(await api.giveDeck(deckId, chosen, due || null));
      setDue('');
    });
  };

  return (
    <Dialog open onClose={onClose} title="Дать группе">
      {loadError ? (
        <p className={styles.problem} role="alert">
          {loadError}
        </p>
      ) : !deck || !owned ? (
        <p className={styles.note} aria-busy="true">
          Загружаем…
        </p>
      ) : (
        <>
          <p className={styles.note}>
            Участники найдут колоду у себя в «Мои колоды». С датой «Выучить к» слова разойдутся поровну по дням до неё,
            а последний день останется для повторения.
          </p>

          {deck.groups.length > 0 && (
            <ul className={styles.given} aria-label="Задано группам">
              {deck.groups.map((group) => (
                <li key={group.id}>
                  <p className={styles.givenName}>
                    <CheckIcon aria-hidden="true" />
                    <span>
                      Задано группе «{group.name}»
                      {group.due_on && <span className={styles.due}> · выучить к {dueLabel(group.due_on)}</span>}
                    </span>
                  </p>
                  <div className={styles.givenControls}>
                    <label className={styles.dueEdit}>
                      <span>Срок</span>
                      <input
                        type="date"
                        min={localToday()}
                        value={group.due_on ?? ''}
                        disabled={busy}
                        onChange={(event) =>
                          run(async () => show(await api.setDeckDue(group.id, deckId, event.target.value || null)))
                        }
                      />
                    </label>
                    {group.due_on && (
                      <button
                        type="button"
                        className={styles.linkButton}
                        disabled={busy}
                        onClick={() => run(async () => show(await api.setDeckDue(group.id, deckId, null)))}
                      >
                        Без срока
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.linkButton}
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await api.takeBackDeck(group.id, deckId);
                          show(await api.teacherDeck(deckId));
                        })
                      }
                    >
                      Забрать
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {free.length > 0 ? (
            <form className={styles.form} onSubmit={submit}>
              {deck.groups.length > 0 && <h3 className={styles.more}>Ещё группе</h3>}
              <label className={styles.field}>
                <span>Группа</span>
                <select value={chosen} onChange={(event) => setGiveTo(event.target.value)}>
                  {free.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Выучить к (необязательно)</span>
                <input type="date" min={localToday()} value={due} onChange={(event) => setDue(event.target.value)} />
              </label>
              <PrimaryButton type="submit" disabled={busy} aria-busy={busy}>
                Задать
              </PrimaryButton>
            </form>
          ) : owned.length > 0 ? (
            <p className={styles.note}>Колода задана всем вашим группам.</p>
          ) : (
            <p className={styles.note}>
              Колоду можно дать группе, которую вы создали. Создайте её во вкладке «Друзья».
            </p>
          )}

          {error && (
            <p className={styles.problem} role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}
