/** «Планы» over HTTP (ADR 0084): online first; the screen updates at once and saves behind. */
import { request } from '../lib/api.ts';

export interface Task {
  id: string;
  title: string;
  notes: string;
  due_on: string | null;
  start_minute: number | null;
  repeat_mask: number;
  repeat_until: string | null;
  priority: 0 | 1 | 2 | 3;
  kind: 'task' | 'study';
}

export type MarkState = 'done' | 'skipped';

/** A task on a day (or with no date, `on` null), with how it stands for me. */
export interface Item {
  task: Task;
  on: string | null;
  state: MarkState | null;
  overdue: boolean;
}

export interface TaskInput {
  title: string;
  notes?: string;
  due_on?: string | null;
  start_minute?: number | null;
  repeat_mask?: number;
  priority?: number;
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
};
