/**
 * «Задачи группы» (ADR 0085): the group's to-do list on its page. The teacher adds tasks (they
 * appear in every member's «Планы»); everyone sees, per task, how many did it today and each
 * member's week, a dot a day. Members are named, never ranked. A student tapping a task gets the
 * same view as in «Планы» (ADR 0092): what, when, and their own week, with its one button.
 */
import { useState } from 'react';
import { t } from '../i18n/index.ts';
import type { Board, GroupTask } from '../lib/types.ts';
import { PlusIcon, TrashIcon } from '../ui/icons.tsx';
import { tasksApi, type Item, type TaskInput } from '../planner/api.ts';
import { TaskView } from '../planner/TaskView.tsx';
import { playTaskDone } from '../lib/sounds.ts';
import { whenLabel } from '../planner/DatePicker.tsx';
import { QuickAdd } from '../planner/QuickAdd.tsx';
import styles from './GroupTasks.module.css';

interface Props {
  board: Board;
  onChanged: () => void;
}

const MARK = {
  done: () => t.taskMarkDone,
  skipped: () => t.taskMarkSkipped,
  none: () => t.taskMarkNotDone,
  off: () => t.taskMarkOff,
};

export function GroupTasks({ board, onChanged }: Props) {
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Item | null>(null);
  const teacher = board.group.can.includes('manage_tasks');
  // Who the tasks are for: everyone but the teacher.
  const students = board.rows.filter((row) => row.role !== 'owner');
  const todayIndex = Math.max(
    0,
    Math.min(6, Math.round((Date.parse(board.today) - Date.parse(board.week_start)) / 86_400_000)),
  );

  if (!teacher && board.tasks.length === 0) return null;

  const add = async (input: TaskInput) => {
    await tasksApi.createForGroup(board.group.id, input);
    onChanged();
  };
  // A student's tap: the task as it stands for me today (from «Планы»'s own list, so a study task
  // ticked by practice says so), or, if it isn't on today, the task alone.
  const view = (task: GroupTask) => {
    const alone: Item = {
      task: { ...task.task, group_name: task.task.group_name ?? board.group.name },
      on: null,
      state: null,
      overdue: false,
    };
    setViewing(alone);
    tasksApi.list(board.today, board.today).then(
      (got) => {
        const mine = got.items.find((i) => i.task.id === task.task.id && i.on === board.today);
        if (mine) setViewing((now) => (now?.task.id === mine.task.id ? { ...mine, task: alone.task } : now));
      },
      () => undefined,
    );
  };
  const mark = (item: Item, state: 'done' | 'skipped' | null) => {
    if (!item.on) return;
    const on = item.on;
    setViewing({ ...item, state });
    const save = state === null ? tasksApi.unmark(item.task.id, on) : tasksApi.mark(item.task.id, on, state);
    if (state === 'done') {
      navigator.vibrate?.(12);
      playTaskDone();
    }
    // Saved, the group's page follows; failed, the view says what is true again.
    save.then(onChanged, () => setViewing((now) => (now?.task.id === item.task.id ? item : now)));
  };
  const remove = async (task: GroupTask) => {
    await tasksApi.remove(task.task.id);
    onChanged();
  };

  return (
    <section aria-labelledby="group-tasks-title" className={styles.block}>
      <div className={styles.head}>
        <h2 id="group-tasks-title" className={styles.title}>
          {t.groupTasks}
        </h2>
        {teacher && (
          <button type="button" className={styles.add} onClick={() => setAdding(true)}>
            <PlusIcon aria-hidden="true" /> {t.groupTaskAdd}
          </button>
        )}
      </div>
      {board.tasks.length === 0 && <p className={styles.empty}>{t.groupTasksEmpty}</p>}
      <ul className={styles.list}>
        {board.tasks.map((task) => {
          const doneToday = students.filter((row) => task.marks[row.member_id]?.[todayIndex] === 'done').length;
          const expanded = open === task.task.id;
          return (
            <li key={task.task.id} className={styles.task}>
              <button
                type="button"
                className={styles.taskHead}
                aria-expanded={teacher ? expanded : undefined}
                aria-haspopup={teacher ? undefined : 'dialog'}
                onClick={() => (teacher ? setOpen(expanded ? null : task.task.id) : view(task))}
              >
                <span className={styles.taskTitle}>{task.task.title}</span>
                <span className={styles.taskWhen}>
                  {whenLabel(
                    {
                      dueOn: task.task.due_on,
                      startMinute: task.task.start_minute,
                      endMinute: task.task.end_minute ?? null,
                      repeatMask: task.task.repeat_mask,
                    },
                    board.today,
                  )}
                </span>
                {task.on_today && students.length > 0 && (
                  <span className={styles.count} data-all={doneToday === students.length || undefined}>
                    {t.groupTaskDoneToday(doneToday, students.length)}
                  </span>
                )}
              </button>
              {teacher && expanded && (
                <div className={styles.detail}>
                  <ul className={styles.members}>
                    {/* The teacher follows everyone; a student opens the task's view instead (ADR 0092). */}
                    {students.map((row) => (
                      <li key={row.member_id} className={styles.member}>
                        <span className={styles.name}>{row.name}</span>
                        <span className={styles.dots}>
                          {task.week.map((on, d) => {
                            const mark = task.marks[row.member_id]?.[d] ?? null;
                            // Done shows on the day it was done, scheduled or not (ADR 0095).
                            const state = mark ?? (on ? 'none' : 'off');
                            return (
                              <span
                                key={d}
                                className={styles.dot}
                                data-state={state}
                                data-today={d === todayIndex || undefined}
                                title={`${t.weekdays[d]}: ${MARK[state]()}`}
                                aria-label={`${t.weekdays[d]}: ${MARK[state]()}`}
                                role="img"
                              />
                            );
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {teacher && (
                    <button type="button" className={styles.delete} onClick={() => void remove(task)}>
                      <TrashIcon aria-hidden="true" /> {t.groupTaskDelete}
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {viewing && (
        <TaskView
          key={`${viewing.task.id}:${viewing.on ?? ''}`}
          item={viewing}
          today={board.today}
          onClose={() => setViewing(null)}
          onToggle={() => mark(viewing, viewing.state === 'done' ? null : 'done')}
          onSkip={() => {
            mark(viewing, 'skipped');
            setViewing(null);
          }}
        />
      )}
      {adding && <QuickAdd today={board.today} day={board.today} onAdd={add} onClose={() => setAdding(false)} />}
    </section>
  );
}
