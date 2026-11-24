/**
 * «Задачи группы» (ADR 0085): the group's to-do list on its page. The teacher adds tasks (they
 * appear in every member's «Планы»); everyone sees, per task, how many did it today and each
 * member's week, a dot a day. Members are named, never ranked.
 */
import { useState } from 'react';
import { t } from '../i18n/index.ts';
import type { Board, GroupTask } from '../lib/types.ts';
import { PlusIcon, TrashIcon } from '../ui/icons.tsx';
import { tasksApi, type TaskInput } from '../planner/api.ts';
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
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : task.task.id)}
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
              {expanded && (
                <div className={styles.detail}>
                  <ul className={styles.members}>
                    {students.map((row) => (
                      <li key={row.member_id} className={styles.member}>
                        <span className={styles.name}>{row.name}</span>
                        <span className={styles.dots}>
                          {task.week.map((on, d) => {
                            const mark = task.marks[row.member_id]?.[d] ?? null;
                            const state = !on ? 'off' : (mark ?? 'none');
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
      {adding && <QuickAdd today={board.today} day={board.today} onAdd={add} onClose={() => setAdding(false)} />}
    </section>
  );
}
