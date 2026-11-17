import { useEffect, useMemo, useState } from 'react';
import { describeError } from '../lib/api.ts';
import { BackIcon } from '../ui/icons.tsx';
import { t } from '../i18n/index.ts';
import { EventDialog } from './EventDialog.tsx';
import { createEvent, deleteEvent, listEvents, updateEvent } from './api.ts';
import type { ScheduleEvent, ScheduleEventInput } from './types.ts';
import styles from './ScheduleView.module.css';

interface ScheduleViewProps {
  onBack: () => void;
}

/** Hours on the vertical axis: 5 AM to 11 PM. */
const START_HOUR = 5;
const END_HOUR = 23;
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
/** Pixels per hour row. Blocks are positioned with the same unit. */
const HOUR_PX = 48;

/** Compute the top (px) and height (px) of a block given its minutes-from-midnight bounds. */
export function blockGeometry(startMinute: number, endMinute: number): { top: number; height: number } {
  const startOffset = Math.max(0, startMinute - START_HOUR * 60);
  const endOffset = Math.max(startOffset + 1, endMinute - START_HOUR * 60);
  return {
    top: (startOffset / 60) * HOUR_PX,
    height: Math.max(20, ((endOffset - startOffset) / 60) * HOUR_PX),
  };
}

/** Local weekday index (0 = Mon … 6 = Sun), from JS's Sun = 0 convention. */
function weekdayOf(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** Minutes-from-midnight → "HH:MM" for display on event blocks. */
function formatMinute(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
}

export function ScheduleView({ onBack }: ScheduleViewProps) {
  const [events, setEvents] = useState<ScheduleEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduleEvent | null>(null);
  const [dialogDefaults, setDialogDefaults] = useState<{ startMinute: number; weekdayIndex: number } | undefined>(
    undefined,
  );
  const [dialogNonce, setDialogNonce] = useState(0);
  const [now, setNow] = useState(() => new Date());

  // Re-render the current-time marker every minute.
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Initial load of events.
  useEffect(() => {
    (async () => {
      try {
        setEvents(await listEvents());
      } catch (caught) {
        setError(describeError(caught));
      }
    })();
  }, []);

  async function refresh() {
    try {
      setEvents(await listEvents());
    } catch (caught) {
      setError(describeError(caught));
    }
  }

  const todayIndex = weekdayOf(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowMarker = blockGeometry(nowMinutes, nowMinutes + 1).top;

  const eventsByDay = useMemo(() => {
    const by: ScheduleEvent[][] = [[], [], [], [], [], [], []];
    for (const e of events ?? []) {
      for (let day = 0; day < 7; day += 1) {
        if (e.weekdays & (1 << day)) by[day].push(e);
      }
    }
    return by;
  }, [events]);

  const openCreate = (weekdayIndex: number, startMinute: number) => {
    setEditing(null);
    setDialogDefaults({ weekdayIndex, startMinute });
    setDialogNonce((n) => n + 1);
    setDialogOpen(true);
  };

  const openEdit = (event: ScheduleEvent) => {
    setEditing(event);
    setDialogDefaults(undefined);
    setDialogNonce((n) => n + 1);
    setDialogOpen(true);
  };

  const save = async (input: ScheduleEventInput) => {
    if (editing) await updateEvent(editing.id, input);
    else await createEvent(input);
    setDialogOpen(false);
    await refresh();
  };

  const remove = async () => {
    if (!editing) return;
    await deleteEvent(editing.id);
    setDialogOpen(false);
    await refresh();
  };

  if (error) {
    return (
      <main className={styles.errorScreen}>
        <p role="alert">{error}</p>
      </main>
    );
  }

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <button type="button" className={styles.backBtn} onClick={onBack} aria-label={t.scheduleBack}>
          <BackIcon aria-hidden="true" />
        </button>
        <h1 className={styles.title}>{t.scheduleHeading}</h1>
      </header>

      <div className={styles.gridWrap}>
        {/* Sticky day header row */}
        <div className={styles.headerRow}>
          <div className={styles.cornerHead} />
          {t.weekdays.map((dayName, dayIndex) => (
            <div key={dayIndex} className={`${styles.dayHead} ${dayIndex === todayIndex ? styles.dayHeadToday : ''}`}>
              {dayName}
            </div>
          ))}
        </div>

        {/* Body: hour axis + 7 day columns. Labels sit ON hour lines (FullCalendar pattern). */}
        <div className={styles.grid} style={{ height: `${HOURS.length * HOUR_PX}px` }}>
          <div className={styles.hourAxis}>
            {HOURS.map((h) => (
              <div key={h} className={styles.hourLabel} style={{ top: `${(h - START_HOUR) * HOUR_PX}px` }}>
                {h.toString().padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {t.weekdays.map((_dayName, dayIndex) => (
            <div
              key={dayIndex}
              className={styles.dayCol}
              onClick={(e) => {
                // Only open create when the empty column itself is clicked (not a child event).
                if (e.currentTarget !== e.target) return;
                const bounds = e.currentTarget.getBoundingClientRect();
                const yPx = e.clientY - bounds.top;
                const minute = Math.round((yPx / HOUR_PX) * 60) + START_HOUR * 60;
                // Snap to the nearest 15 min for the default; the dialog allows any minute.
                const snapped = Math.max(START_HOUR * 60, Math.round(minute / 15) * 15);
                openCreate(dayIndex, snapped);
              }}
            >
              {HOURS.map((h) => (
                <div key={h} className={styles.hourLine} style={{ top: `${(h - START_HOUR) * HOUR_PX}px` }} />
              ))}
              {dayIndex === todayIndex && <div className={styles.nowMarker} style={{ top: `${nowMarker}px` }} />}
              {eventsByDay[dayIndex].map((event) => {
                const { top, height } = blockGeometry(event.startMinute, event.endMinute);
                return (
                  <button
                    type="button"
                    key={event.id}
                    className={`${styles.eventBlock} ${styles[`kind_${event.kind}`]}`}
                    style={{ top: `${top}px`, height: `${height}px` }}
                    onClick={(e) => {
                      e.stopPropagation();
                      openEdit(event);
                    }}
                  >
                    <span className={styles.eventTime}>
                      {formatMinute(event.startMinute)}–{formatMinute(event.endMinute)}
                    </span>
                    <span className={styles.eventTitle}>{event.title}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {events !== null && events.length === 0 && <p className={styles.empty}>{t.scheduleEmpty}</p>}

      <EventDialog
        key={`${editing?.id ?? 'new'}-${dialogNonce}`}
        open={dialogOpen}
        initial={editing}
        defaults={dialogDefaults}
        onClose={() => setDialogOpen(false)}
        onSave={save}
        onDelete={editing ? remove : undefined}
      />
    </main>
  );
}
