/** «Планы» over HTTP (ADR 0084): online first; the screen updates at once and saves behind. */
import { request } from '../lib/api.ts';

export interface Task {
  id: string;
  title: string;
  notes: string;
  due_on: string | null;
  start_minute: number | null;
  /** «с 19:00 до 20:00»: until when, if set (ADR 0087). */
  end_minute?: number | null;
  repeat_mask: number;
  repeat_until: string | null;
  priority: 0 | 1 | 2 | 3;
  kind: 'task' | 'study';
  /** A group's task (ADR 0085): its teacher sets it, I tick it for myself. */
  group_id?: string | null;
  group_name?: string | null;
  /** A group task's material (ADR 0096): opened from the task, and doing it ticks the task. */
  link?: TaskLink | null;
}

export type LinkKind = 'deck' | 'reading' | 'writing' | 'speaking' | 'shadowing';

export interface TaskLink {
  kind: LinkKind;
  /** The item's id: a deck's, `library:<article>` / `reading:<id>`, a question's, an exercise's. */
  ref: string;
  title: string;
}

export type MarkState = 'done' | 'skipped';

/** A task on a day (or with no date, `on` null), with how it stands for me. */
export interface Item {
  task: Task;
  on: string | null;
  state: MarkState | null;
  overdue: boolean;
  /** Done because I practised that day (a study task, ADR 0086) or did its material (ADR 0096). */
  by_practice?: boolean;
}

export interface TaskInput {
  title: string;
  notes?: string;
  due_on?: string | null;
  start_minute?: number | null;
  end_minute?: number | null;
  repeat_mask?: number;
  priority?: number;
  link?: { kind: LinkKind; ref: string } | null;
  kind?: 'task' | 'study';
}

export type Scope = 'all' | 'future' | 'one';

const q = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return s ? `?${s}` : '';
};

export const tasksApi = {
  list: (start: string, end: string) => request<{ today: string; items: Item[] }>('GET', `/tasks${q({ start, end })}`),
  create: (body: TaskInput) => request<Task>('POST', '/tasks', body),
  update: (id: string, patch: Partial<TaskInput>, scope: Scope = 'all', on?: string | null) =>
    request<Task>('PATCH', `/tasks/${id}${q({ scope, on: on ?? undefined })}`, patch),
  remove: (id: string, scope: Scope = 'all', on?: string | null) =>
    request<null>('DELETE', `/tasks/${id}${q({ scope, on: on ?? undefined })}`),
  mark: (id: string, on: string, state: MarkState = 'done') =>
    request<null>('PUT', `/tasks/${id}/marks/${on}`, { state }),
  unmark: (id: string, on: string) => request<null>('DELETE', `/tasks/${id}/marks/${on}`),
  /** A task for a whole group, by its teacher (ADR 0085). */
  createForGroup: (groupId: string, body: TaskInput) => request<Task>('POST', `/groups/${groupId}/tasks`, body),
};
