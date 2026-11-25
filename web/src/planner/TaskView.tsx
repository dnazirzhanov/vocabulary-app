/**
 * A group's task as a student sees it (ADR 0092): what it is, from which group, when and on which
 * days, and their own week on it. Nothing to edit (it is the teacher's), and nothing about anyone
 * else: enough to know the task and keep it, no more. Tick it here, or skip today.
 */
import { useEffect, useState } from 'react';
import { t } from '../i18n/index.ts';
import { CloseIcon, PeopleIcon } from '../ui/icons.tsx';
import { tasksApi, type Item, type MarkState } from './api.ts';
import { whenLabel } from './DatePicker.tsx';
import { addDays, weekday } from './dates.ts';
import styles from './Planner.module.css';

interface Props {
  item: Item;
  today: string;
  onToggle: () => void;
  onSkip: () => void;
  onClose: () => void;
}

type Day = { day: string; on: boolean; state: MarkState | null };

export function TaskView({ item, today, onToggle, onSkip, onClose }: Props) {
  const { task } = item;
  const monday = addDays(today, -weekday(today));
  const [week, setWeek] = useState<Day[] | null>(null);

  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onClose]);

  // My week on this task: which days it is on, and what I did on each.
  useEffect(() => {
    let live = true;
    tasksApi.list(monday, addDays(monday, 6)).then(
      (got) => {
        if (!live) return;
        const mine = got.items.filter((i) => i.task.id === task.id);
        setWeek(
          Array.from({ length: 7 }, (_, n) => {
            const day = addDays(monday, n);
            const found = mine.find((i) => i.on === day);
            return { day, on: Boolean(found), state: found?.state ?? null };
          }),
        );
      },
      () => live && setWeek(null),
    );
    return () => {
      live = false;
    };
  }, [monday, task.id]);

  // The day this view was opened for follows the list at once (a tick is saved behind the screen).
  const days = week?.map((d) => (d.day === item.on ? { ...d, on: true, state: item.state } : d)) ?? null;
  const onDays = days?.filter((d) => d.on && d.day <= today) ?? [];
  const done = onDays.filter((d) => d.state === 'done').length;
  const isDone = item.state === 'done';

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
          {task.group_name && (
            <span className={styles.fromGroup}>
              <PeopleIcon aria-hidden="true" /> {t.groupTaskFrom(task.group_name)}
            </span>
          )}
        </header>
        <h2 className={styles.viewTitle}>{task.title}</h2>
        {task.notes && <p className={styles.viewNotes}>{task.notes}</p>}

        <div className={styles.viewBlock}>
          <span className={styles.viewLabel}>{t.taskWhen}</span>
          <span className={styles.viewValue}>
            {whenLabel(
              {
                dueOn: task.repeat_mask ? null : task.due_on,
                startMinute: task.start_minute,
                endMinute: task.end_minute ?? null,
                repeatMask: task.repeat_mask,
              },
              today,
            ).replace(t.planNoDate + ' · ', '')}
          </span>
          {task.repeat_mask > 0 && (
            <span className={styles.viewDays} aria-hidden="true">
              {t.weekdays.map((d, i) => (
                <span key={d} className={styles.viewDay} data-on={Boolean(task.repeat_mask & (1 << i)) || undefined}>
                  {d}
                </span>
              ))}
            </span>
          )}
        </div>

        {days && onDays.length > 0 && (
          <div className={styles.viewBlock}>
            <span className={styles.viewLabel}>{t.taskMyWeek}</span>
            <span className={styles.viewWeek}>
              {days.map((d, i) => {
                const state = !d.on ? 'off' : (d.state ?? (d.day < today ? 'missed' : 'open'));
                return (
                  <span key={d.day} className={styles.viewWeekDay}>
                    <span className={styles.viewDot} data-state={state} data-today={d.day === today || undefined} />
                    <span className={styles.viewWeekName}>{t.weekdays[i]}</span>
                  </span>
                );
              })}
            </span>
            <span className={styles.viewValue}>{t.taskDoneOf(done, onDays.length)}</span>
          </div>
        )}

        <footer className={styles.detailFoot}>
          {task.repeat_mask > 0 && item.on && !isDone && item.state !== 'skipped' && (
            <button type="button" className={styles.textBtn} onClick={onSkip}>
              {t.taskSkipToday}
            </button>
          )}
          {!item.by_practice && (
            <button type="button" className={styles.saveBtn} onClick={onToggle}>
              {isDone ? t.taskUndo : t.taskMarkAsDone}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
