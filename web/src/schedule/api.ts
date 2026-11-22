import { api, type WireScheduleEvent } from '../lib/api.ts';
import type { EventKind, ScheduleEvent, ScheduleEventInput } from './types.ts';

function fromWire(e: WireScheduleEvent): ScheduleEvent {
  return {
    id: e.id,
    title: e.title,
    kind: e.kind as EventKind,
    weekdays: e.weekdays,
    startMinute: e.start_minute,
    endMinute: e.end_minute,
    onDate: e.on_date ?? null,
    skipped: e.skipped ?? [],
  };
}

function toWire(input: ScheduleEventInput) {
  return {
    title: input.title,
    kind: input.kind,
    weekdays: input.weekdays,
    start_minute: input.startMinute,
    end_minute: input.endMinute,
    on_date: input.onDate ?? null,
  };
}

export async function listEvents(): Promise<ScheduleEvent[]> {
  const { events } = await api.scheduleList();
  return events.map(fromWire);
}

export async function createEvent(input: ScheduleEventInput): Promise<ScheduleEvent> {
  return fromWire(await api.scheduleCreate(toWire(input)));
}

export async function updateEvent(id: string, input: ScheduleEventInput): Promise<ScheduleEvent> {
  return fromWire(await api.scheduleUpdate(id, toWire(input)));
}

export async function deleteEvent(id: string): Promise<void> {
  await api.scheduleDelete(id);
}

/** A repeating block off on one date (ADR 0074), or back on. */
export async function skipDay(id: string, date: string, skip = true): Promise<void> {
  if (skip) await api.scheduleSkip(id, date);
  else await api.scheduleUnskip(id, date);
}
