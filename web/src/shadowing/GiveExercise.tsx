import { useEffect, useState } from 'react';
import { t } from '../i18n/index.ts';
import { api, describeError } from '../lib/api.ts';
import type { Group } from '../lib/types.ts';
import { tasksApi } from '../planner/api.ts';
import { addDays, localToday } from '../planner/dates.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { CheckIcon, ShareIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import type { ShadowingExercise } from './api.ts';
import styles from './GiveExercise.module.css';

type When = 'today' | 'tomorrow' | 'daily';

/**
 * «Дать группе» on a shadowing exercise: one step makes it a group's task with the exercise as its
 * material (ADR 0096), for the groups whose tasks I may set. Members open it from the task, and
 * doing it ticks the task.
 */
export function GiveExercise({ exercise }: { exercise: ShadowingExercise }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [when, setWhen] = useState<When>('today');
  const [title, setTitle] = useState(() => t.shGiveTaskTitle(exercise.title).slice(0, 200));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [given, setGiven] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    api.groups().then(
      (all) => {
        if (cancelled) return;
        const mine = all.filter((g) => g.can.includes('manage_tasks'));
        setGroups(mine);
        if (mine.length === 1) setGroupId(mine[0].id);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Only for someone who sets a group's tasks.
  if (groups.length === 0) return null;

  const give = async () => {
    const group = groups.find((g) => g.id === groupId);
    if (!group || !title.trim() || busy) return;
    setBusy(true);
    setError(null);
    const today = localToday();
    try {
      await tasksApi.createForGroup(group.id, {
        title: title.trim(),
        due_on: when === 'tomorrow' ? addDays(today, 1) : today,
        repeat_mask: when === 'daily' ? 127 : 0,
        link: { kind: 'shadowing', ref: exercise.id },
      });
      setGiven((was) => [...was, group.name]);
      setOpen(false);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const WHEN: [When, string][] = [
    ['today', t.planToday],
    ['tomorrow', t.planTomorrow],
    ['daily', t.planRepeatDaily],
  ];

  return (
    <>
      <button type="button" className={styles.button} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {given.length > 0 ? <CheckIcon aria-hidden="true" /> : <ShareIcon aria-hidden="true" />}
        {given.length > 0 ? t.shGiven(given.at(-1) ?? '') : t.giveToAGroup}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={t.giveToTheGroup(exercise.title)}>
        <div className={styles.form}>
          {groups.length > 1 && (
            <fieldset className={styles.choices}>
              <legend className={styles.label}>{t.groupLabel}</legend>
              {groups.map((g) => (
                <label key={g.id} className={styles.choice}>
                  <input type="radio" name="give-group" checked={groupId === g.id} onChange={() => setGroupId(g.id)} />
                  <span>{g.name}</span>
                </label>
              ))}
            </fieldset>
          )}
          <fieldset className={styles.choices}>
            <legend className={styles.label}>{t.shGiveWhen}</legend>
            {WHEN.map(([value, label]) => (
              <label key={value} className={styles.choice}>
                <input type="radio" name="give-when" checked={when === value} onChange={() => setWhen(value)} />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <label className={styles.label}>
            {t.planTaskTitle}
            <input
              className={styles.input}
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <PrimaryButton
            type="button"
            disabled={busy || !groupId || !title.trim()}
            aria-busy={busy}
            onClick={() => void give()}
          >
            {t.give}
          </PrimaryButton>
        </div>
      </Dialog>
    </>
  );
}
