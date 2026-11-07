import { useEffect, useState, type ChangeEvent, type MouseEvent } from 'react';
import { api, describeError } from '../lib/api.ts';
import { dueLabel, localToday } from '../lib/deadline.ts';
import type { Group, TeacherDeck } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { CheckIcon, CloseIcon } from '../ui/icons.tsx';
import styles from './GiveDialog.module.css';
import { t } from '../i18n/index.ts';

/**
 * «Дать группе» in a window (ADR 0036, 0049): one list of my groups, each saying whether it has the
 * deck and by when, with one thing to do beside it, in the same place: «Дать», then «Отменить».
 * Undoing and giving again leaves everything as it was, so neither needs asking about. It loads the deck and my groups itself, so the
 * deck editor and a deck's own page open it the same way, and tells its opener when the deck changes.
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
  const { run, busy, error } = useAsyncAction();

  useEffect(() => {
    let current = true;
    Promise.all([api.teacherDeck(deckId), api.groups()]).then(
      ([loaded, groups]) => {
        if (!current) return;
        setDeck(loaded);
        setOwned(groups.filter((group) => group.can.includes('give_decks')));
      },
      (caught: unknown) => {
        if (current) setLoadError(describeError(caught));
      },
    );
    return () => {
      current = false;
    };
  }, [deckId]);

  const show = (next: TeacherDeck) => {
    setDeck(next);
    onChanged?.(next);
  };
  const setDue = (groupId: string, due: string | null) =>
    run(async () => show(await api.setDeckDue(groupId, deckId, due)));

  return (
    <Dialog open onClose={onClose} title={t.giveToAGroup}>
      {loadError ? (
        <p className={styles.problem} role="alert">
          {loadError}
        </p>
      ) : !deck || !owned ? (
        <p className={styles.note} aria-busy="true">
          {t.loading}
        </p>
      ) : owned.length === 0 ? (
        <p className={styles.note}>{t.firstCreateAGroupInThe}</p>
      ) : (
        <ul className={styles.groups}>
          {owned.map((group) => {
            const given = deck.groups.find((item) => item.id === group.id);
            return (
              <li key={group.id} className={styles.group} data-given={given ? '' : undefined}>
                <div className={styles.about}>
                  <p className={styles.name}>
                    {given && <CheckIcon aria-hidden="true" />}
                    {group.name}
                  </p>
                  {given && (
                    <DueDate
                      groupName={group.name}
                      due={given.due_on ?? null}
                      disabled={busy}
                      onChange={(due) => void setDue(group.id, due)}
                    />
                  )}
                </div>
                {given ? (
                  <button
                    type="button"
                    className={styles.toggle}
                    disabled={busy}
                    aria-label={t.undoForTheGroup(group.name)}
                    onClick={() =>
                      run(async () => {
                        await api.takeBackDeck(group.id, deckId);
                        show(await api.teacherDeck(deckId));
                      })
                    }
                  >
                    {t.undo}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.toggle}
                    disabled={busy}
                    aria-label={t.giveToTheGroup(group.name)}
                    onClick={() => run(async () => show(await api.giveDeck(deckId, group.id, null)))}
                  >
                    {t.give}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p className={styles.problem} role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

/**
 * The deadline as a line of text that opens the date picker, rather than a form field: most of the
 * time it is only read. The real date input lies over the words, so the phone's own picker opens.
 */
function DueDate(props: {
  groupName: string;
  due: string | null;
  disabled: boolean;
  onChange: (due: string | null) => void;
}) {
  const { groupName, due, disabled, onChange } = props;
  // Desktop browsers open the picker only from their own small icon; this makes the whole line do it.
  const openPicker = (event: MouseEvent<HTMLInputElement>) => {
    try {
      event.currentTarget.showPicker();
    } catch {
      // not supported, or already open: the input still takes the date
    }
  };
  return (
    <div className={styles.due}>
      <label className={styles.dueLine} data-set={due ? '' : undefined}>
        {due ? t.by(dueLabel(due)) : t.setADeadline}
        <input
          type="date"
          aria-label={t.deadlineForTheGroup(groupName)}
          min={localToday()}
          value={due ?? ''}
          disabled={disabled}
          onClick={openPicker}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value || null)}
        />
      </label>
      {due && (
        <button
          type="button"
          className={styles.clearDue}
          disabled={disabled}
          aria-label={t.removeTheDeadlineForTheGroup(groupName)}
          onClick={() => onChange(null)}
        >
          <CloseIcon aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
