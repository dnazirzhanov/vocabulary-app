import { api } from '../lib/api.ts';
import type { EventKind, ScheduleEvent, ScheduleEventInput } from './types.ts';

type WireEvent = {
  id: string;
  title: string;
  kind: string;
  weekdays: number;
  start_minute: number;
  end_minute: number;
};

function fromWire(e: WireEvent): ScheduleEvent {
  return {
    id: e.id,
    title: e.title,
    kind: e.kind as EventKind,
    weekdays: e.weekdays,
    startMinute: e.start_minute,
    endMinute: e.end_minute,
  };
}

function toWire(input: ScheduleEventInput) {
  return {
    title: input.title,
    kind: input.kind,
    weekdays: input.weekdays,
    start_minute: input.startMinute,
    end_minute: input.endMinute,
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
