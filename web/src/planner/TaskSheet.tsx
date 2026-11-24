/**
 * A task's details (ADR 0084): title, notes, date/time/repeat, priority; «Пропустить этот день» and
 * «Удалить». A repeating task asks what a change is for: only this day, this and the following, or
 * all of them (as TickTick does). A bottom sheet on a phone, a side panel on a wide screen.
 */
import { useEffect, useState } from 'react';
import { t } from '../i18n/index.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { CalendarIcon, CloseIcon, FlagIcon, TrashIcon } from '../ui/icons.tsx';
import type { Item, Scope, TaskInput } from './api.ts';
import { DatePicker, whenLabel, type When } from './DatePicker.tsx';
import styles from './Planner.module.css';

interface Props {
  item: Item;
  today: string;
  onSave: (patch: Partial<TaskInput>, scope: Scope) => Promise<void>;
  onSkip: () => void;
  onDelete: (scope: Scope) => void;
  onClose: () => void;
}

export function TaskSheet({ item, today, onSave, onSkip, onDelete, onClose }: Props) {
  const { task } = item;
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [priority, setPriority] = useState(task.priority);
  const [when, setWhen] = useState<When>({
    dueOn: task.repeat_mask ? item.on : task.due_on,
    startMinute: task.start_minute,
    repeatMask: task.repeat_mask,
  });
  const [picking, setPicking] = useState(false);
  const [asking, setAsking] = useState<'save' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const repeating = task.repeat_mask > 0;
  // A group's task is its teacher's to change (ADR 0085): here it is read, ticked or skipped.
  const own = !task.group_id;

  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === 'Escape' && !asking && onClose();
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onClose, asking]);

  const patch = (): Partial<TaskInput> => {
    const out: Partial<TaskInput> = {};
    if (title.trim() && title.trim() !== task.title) out.title = title.trim();
    if (notes !== task.notes) out.notes = notes;
    if (priority !== task.priority) out.priority = priority;
    if (when.startMinute !== task.start_minute) out.start_minute = when.startMinute;
    if (when.repeatMask !== task.repeat_mask) out.repeat_mask = when.repeatMask;
    const shownDay = repeating ? item.on : task.due_on;
    if (when.dueOn !== shownDay) out.due_on = when.dueOn;
    return out;
  };
  const changes = patch();
  const changed = Object.keys(changes).length > 0;

  const save = async (scope: Scope) => {
    setAsking(null);
    setBusy(true);
    try {
      // For the whole series, the series keeps its first day unless a new one is chosen.
      const body = { ...changes };
      if (repeating && scope === 'all' && body.due_on === undefined) delete body.due_on;
      await onSave(body, scope);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={styles.sheetLayer}
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section className={`${styles.sheet} ${styles.detail}`} role="dialog" aria-modal="true" aria-label={task.title}>
        <header className={styles.detailHead}>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label={t.planClose}>
            <CloseIcon aria-hidden="true" />
          </button>
          <span className={styles.detailWhen}>{whenLabel(when, today)}</span>
        </header>
        {!own && <p className={styles.fromGroup}>{t.groupTaskFrom(task.group_name ?? '')}</p>}
        <input
          className={styles.detailTitle}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label={t.planTaskTitle}
          maxLength={200}
          readOnly={!own}
        />
        <textarea
          readOnly={!own}
          className={styles.detailNotes}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t.planNotes}
          aria-label={t.planNotes}
          rows={3}
          maxLength={2000}
        />
        <button
          type="button"
          className={styles.detailRow}
          aria-expanded={picking}
          onClick={() => setPicking((p) => !p)}
        >
          <CalendarIcon aria-hidden="true" />
          <span>{whenLabel(when, today)}</span>
        </button>
        {picking && <DatePicker value={when} today={today} onChange={setWhen} />}
        <div className={styles.priorityRow} role="radiogroup" aria-label={t.planPriority} hidden={!own}>
          {t.planPriorities.map((label, p) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={priority === p}
              className={styles.priorityChip}
              data-priority={p}
              onClick={() => setPriority(p as 0 | 1 | 2 | 3)}
            >
              <FlagIcon aria-hidden="true" /> {label}
            </button>
          ))}
        </div>
        <footer className={styles.detailFoot}>
          {own && (
            <button
              type="button"
              className={styles.textDanger}
              onClick={() => (repeating ? setAsking('delete') : onDelete('all'))}
            >
              <TrashIcon aria-hidden="true" /> {t.planDelete}
            </button>
          )}
          {repeating && item.on && (
            <button type="button" className={styles.textBtn} onClick={onSkip}>
              {t.planSkipDay}
            </button>
          )}
          {own && (
            <button
              type="button"
              className={styles.saveBtn}
              disabled={!changed || !title.trim() || busy}
              onClick={() => (repeating ? setAsking('save') : void save('all'))}
            >
              {t.planSave}
            </button>
          )}
        </footer>
      </section>
      <Dialog
        open={asking !== null}
        onClose={() => setAsking(null)}
        title={asking === 'delete' ? t.planDeleteScopeTitle : t.planScopeTitle}
      >
        <div className={styles.scopeList}>
          {(['one', 'future', 'all'] as const).map((scope) => (
            <button
              key={scope}
              type="button"
              className={styles.scopeBtn}
              onClick={() => {
                if (asking === 'delete') {
                  setAsking(null);
                  onDelete(scope);
                } else void save(scope);
              }}
            >
              {{ one: t.planScopeOne, future: t.planScopeFuture, all: t.planScopeAll }[scope]}
            </button>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
