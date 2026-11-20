import { useState } from 'react';
import { Dialog } from '../ui/Dialog.tsx';
import { t } from '../i18n/index.ts';
import type { EventKind, ScheduleEvent, ScheduleEventInput } from './types.ts';
import { EVENT_KINDS, daysToMask, maskToDays } from './types.ts';
import styles from './EventDialog.module.css';

interface EventDialogProps {
  open: boolean;
  initial: ScheduleEvent | null;
  defaults?: { startMinute: number; weekdayIndex: number };
  onClose: () => void;
  onSave: (input: ScheduleEventInput) => Promise<void>;
  onDelete?: () => Promise<void>;
}

/** Format minutes-from-midnight as "HH:MM" for <input type="time">. */
function fmt(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
}

/** Parse "HH:MM" back to minutes-from-midnight. Returns 0 on bad input. */
function parse(s: string): number {
  const [h, m] = s.split(':').map((n) => parseInt(n, 10));
  if (isNaN(h) || isNaN(m)) return 0;
  return h * 60 + m;
}

// Form state is computed once per mount from props. The parent passes a `key` so a fresh dialog
// (new event, or editing a different event) remounts with fresh initial values.
export function EventDialog({ open, initial, defaults, onClose, onSave, onDelete }: EventDialogProps) {
  const startDefault = initial?.startMinute ?? defaults?.startMinute ?? 480;
  const endDefault = initial?.endMinute ?? (defaults?.startMinute != null ? defaults.startMinute + 60 : 540);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [kind, setKind] = useState<EventKind>(initial?.kind ?? 'school');
  const [days, setDays] = useState<number[]>(initial ? maskToDays(initial.weekdays) : [defaults?.weekdayIndex ?? 0]);
  const [startTime, setStartTime] = useState(fmt(startDefault));
  const [endTime, setEndTime] = useState(fmt(endDefault));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startMinute = parse(startTime);
  const endMinute = parse(endTime);

  const validate = (): string | null => {
    if (title.trim().length === 0) return t.eventDialogErrorEmptyTitle;
    if (days.length === 0) return t.eventDialogErrorNoDays;
    if (endMinute <= startMinute) return t.eventDialogErrorEndBeforeStart;
    return null;
  };

  const handleSave = async () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      await onSave({
        title: title.trim(),
        kind,
        weekdays: daysToMask(days),
        startMinute,
        endMinute,
      });
    } catch {
      setError(t.scheduleSaveFailed);
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setBusy(true);
    try {
      await onDelete();
    } catch {
      setError(t.scheduleDeleteFailed);
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={initial ? t.eventDialogEditTitle : t.eventDialogAddTitle}>
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
      >
        <label className={styles.titleField}>
          <span className={styles.srOnly}>{t.eventDialogTitleLabel}</span>
          <input
            type="text"
            className={styles.titleInput}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t.eventDialogTitleLabel}
            maxLength={80}
            data-autofocus
          />
        </label>

        <div className={styles.row}>
          <span className={`${styles.kindDotLarge} ${styles[`kind_${kind}`]}`} aria-hidden="true" />
          <div className={styles.kindOptions} role="group" aria-label={t.eventDialogKindLabel}>
            {EVENT_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                className={`${styles.kindChip} ${styles[`kind_${k}`]}${kind === k ? ` ${styles.kindSelected}` : ''}`}
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
              >
                {kindLabel(k)}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.row}>
          <span className={styles.rowLabel}>{t.eventDialogDaysLabel}</span>
          <div className={styles.dayCircles} role="group" aria-label={t.eventDialogDaysLabel}>
            {t.weekdays.map((name, idx) => {
              const on = days.includes(idx);
              return (
                <button
                  key={idx}
                  type="button"
                  className={`${styles.dayCircle}${on ? ` ${styles.dayCircleOn}` : ''}`}
                  aria-pressed={on}
                  aria-label={name}
                  onClick={() => {
                    if (on && days.length === 1) return; // at least one day stays on
                    setDays(on ? days.filter((d) => d !== idx) : [...days, idx].sort((a, b) => a - b));
                  }}
                >
                  {name.charAt(0)}
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.row}>
          <span className={styles.rowLabel}>{t.eventDialogStartLabel}</span>
          <div className={styles.timeRange}>
            <input
              type="time"
              className={styles.timeInput}
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              aria-label={t.eventDialogStartLabel}
            />
            <span className={styles.timeDash} aria-hidden="true">
              –
            </span>
            <input
              type="time"
              className={styles.timeInput}
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              aria-label={t.eventDialogEndLabel}
            />
          </div>
        </div>

        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}

        <div className={styles.actions}>
          {onDelete && (
            <button type="button" className={styles.deleteBtn} disabled={busy} onClick={() => void handleDelete()}>
              {t.eventDialogDelete}
            </button>
          )}
          <div className={styles.rightActions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={busy}>
              {t.eventDialogCancel}
            </button>
            <button type="submit" className={styles.saveBtn} disabled={busy}>
              {t.eventDialogSave}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}

function kindLabel(k: EventKind): string {
  switch (k) {
    case 'school':
      return t.scheduleKindSchool;
    case 'work':
      return t.scheduleKindWork;
    case 'sport':
      return t.scheduleKindSport;
    case 'chore':
      return t.scheduleKindChore;
    case 'personal':
      return t.scheduleKindPersonal;
    case 'other':
      return t.scheduleKindOther;
  }
}
