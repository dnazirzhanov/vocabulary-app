/**
 * The learner's week (ADR 0073), the calendar the mentor plans around. Chosen from a 7-column grid
 * (the old one: ~45 px a day on a phone), a month grid, an agenda list, a 3-day grid, a heat-map
 * week and a strip with a day timeline: on phones a week strip above one day's timeline, the only
 * shape readable at 360 px and still exact; from 1024 px the whole week side by side.
 *
 * Exact: blocks that overlap sit side by side, heights are true to the minute, the hours grow to
 * fit early and late blocks, the dates are real, and the now line is in the learner's own time.
 * Useful: today's study tasks sit in the free time with «Начать», the promised study time shows
 * on its days, free gaps are named. Easy to fill: tell the mentor about the week in your words,
 * or start from a template; then «+», tap to change, drag to move, drag the edge to resize.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { describeError } from '../lib/api.ts';
import { t, uiLanguage } from '../i18n/index.ts';
import { BackIcon, CheckIcon, ForwardIcon, PlusIcon, SparkleIcon } from '../ui/icons.tsx';
import { EventDialog } from './EventDialog.tsx';
import { createEvent, deleteEvent, listEvents, skipDay, updateEvent } from './api.ts';
import { freeGaps, hourRange, placeLanes, snap, weekOf } from './layout.ts';
import { happensOn, isoDay, type ScheduleEvent, type ScheduleEventInput } from './types.ts';
import styles from './ScheduleView.module.css';

export interface StudyBlock {
  key: string;
  title: string;
  minutes: number;
  at: number | null;
  onStart: () => void;
}

interface ScheduleViewProps {
  onBack: () => void;
  /** Today's tasks with their times, shown as study blocks today. */
  study?: StudyBlock[];
  /** The promised study time, shown on its days. */
  commitment?: { weekdays: number[]; start: number | null; minutes: number | null } | null;
  /** Hands a question to the mentor's chat (telling it about the week). */
  onAsk?: (question: string) => void;
}

const HOUR_PX = 56;
const PX = HOUR_PX / 60;

/** Block geometry, exact to the minute; anything shorter than 15 minutes is drawn as 15. */
export function blockGeometry(start: number, end: number, firstHour = 7): { top: number; height: number } {
  return { top: (start - firstHour * 60) * PX, height: Math.max(15, end - start) * PX };
}

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const weekdayOf = (d: Date) => (d.getDay() + 6) % 7;

const TEMPLATES: { id: string; name: () => string; events: () => ScheduleEventInput[] }[] = [
  {
    id: 'school',
    name: () => t.scheduleTemplateSchool,
    events: () => [
      { title: t.scheduleTemplateSchoolEvent, kind: 'school', weekdays: 31, startMinute: 480, endMinute: 840 },
    ],
  },
  {
    id: 'student',
    name: () => t.scheduleTemplateStudent,
    events: () => [
      { title: t.scheduleTemplateStudentEvent, kind: 'school', weekdays: 31, startMinute: 540, endMinute: 960 },
    ],
  },
  {
    id: 'work',
    name: () => t.scheduleTemplateWork,
    events: () => [
      { title: t.scheduleTemplateWorkEvent, kind: 'work', weekdays: 31, startMinute: 540, endMinute: 1080 },
    ],
  },
];

function useWide(): boolean {
  const query = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const list = matchMedia(query);
    const change = () => setWide(list.matches);
    list.addEventListener('change', change);
    return () => list.removeEventListener('change', change);
  }, []);
  return wide;
}

export function ScheduleView({ onBack, study = [], commitment = null, onAsk }: ScheduleViewProps) {
  const [events, setEvents] = useState<ScheduleEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [day, setDay] = useState(() => new Date());
  const [dialog, setDialog] = useState<{
    event: ScheduleEvent | null;
    start?: number;
    weekday?: number;
    date?: Date;
    n: number;
  } | null>(null);
  const [preview, setPreview] = useState<{ name: string; events: ScheduleEventInput[] } | null>(null);
  const [told, setTold] = useState('');
  const wide = useWide();

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(tick);
  }, []);

  const refresh = () => listEvents().then(setEvents, (caught: unknown) => setError(describeError(caught)));
  useEffect(() => {
    void listEvents().then(setEvents, (caught: unknown) => setError(describeError(caught)));
  }, []);

  const week = useMemo(() => weekOf(day), [day]);
  const shown = wide ? week : [day];

  const save = async (input: ScheduleEventInput) => {
    if (dialog?.event) await updateEvent(dialog.event.id, input);
    else await createEvent(input);
    setDialog(null);
    await refresh();
  };
  const remove = async () => {
    if (!dialog?.event) return;
    await deleteEvent(dialog.event.id);
    setDialog(null);
    await refresh();
  };
  const move = async (event: ScheduleEvent, start: number, end: number) => {
    setEvents((was) => was?.map((e) => (e.id === event.id ? { ...e, startMinute: start, endMinute: end } : e)) ?? was);
    try {
      await updateEvent(event.id, { ...event, startMinute: start, endMinute: end });
    } catch (caught) {
      setError(describeError(caught));
      await refresh();
    }
  };
  const addAll = async () => {
    if (!preview) return;
    try {
      for (const e of preview.events) await createEvent(e);
      setPreview(null);
      await refresh();
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  const shiftWeek = (weeks: number) => setDay((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + weeks * 7));
  const monthLabel = week[0].toLocaleDateString(uiLanguage, { month: 'long', year: 'numeric' });

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <button type="button" className={styles.iconButton} onClick={onBack} aria-label={t.scheduleBack}>
          <BackIcon aria-hidden="true" />
        </button>
        <h1 className={styles.title}>{t.scheduleHeading}</h1>
        <button
          type="button"
          className={styles.addButton}
          aria-label={t.scheduleAdd}
          onClick={() =>
            setDialog({
              event: null,
              start: snap(Math.max(now.getHours() * 60, 8 * 60)),
              weekday: weekdayOf(day),
              n: Date.now(),
            })
          }
        >
          <PlusIcon aria-hidden="true" />
        </button>
      </header>

      {/* The week strip: real dates, today marked, a dot on busy days. */}
      <nav className={styles.strip} aria-label={monthLabel}>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t.schedulePrevWeek}
          onClick={() => shiftWeek(-1)}
        >
          <BackIcon aria-hidden="true" />
        </button>
        <ol className={styles.days}>
          {week.map((d) => {
            const busy = (events ?? []).some((e) => happensOn(e, d));
            return (
              <li key={d.toISOString()}>
                <button
                  type="button"
                  className={styles.day}
                  aria-current={sameDay(d, now) ? 'date' : undefined}
                  aria-pressed={!wide ? sameDay(d, day) : undefined}
                  aria-label={d.toLocaleDateString(uiLanguage, { weekday: 'long', day: 'numeric', month: 'long' })}
                  onClick={() => setDay(d)}
                >
                  <span className={styles.dayName}>{t.weekdays[weekdayOf(d)]}</span>
                  <span className={styles.dayNumber}>{d.getDate()}</span>
                  <span className={styles.dot} data-on={busy || undefined} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t.scheduleNextWeek}
          onClick={() => shiftWeek(1)}
        >
          <ForwardIcon aria-hidden="true" />
        </button>
      </nav>
      {!week.some((d) => sameDay(d, now)) && (
        <button type="button" className={styles.todayLink} onClick={() => setDay(new Date())}>
          {t.scheduleToday}
        </button>
      )}

      {error && (
        <p className={styles.problem} role="alert">
          {error}
        </p>
      )}

      {/* An empty week: tell the mentor about it, or start from a template. */}
      {events !== null && events.length === 0 && (
        <section className={styles.fill} aria-labelledby="schedule-fill">
          <h2 id="schedule-fill">{t.scheduleTellHeading}</h2>
          <p>{t.scheduleTellLead}</p>
          {onAsk && (
            <form
              className={styles.tell}
              onSubmit={(event) => {
                event.preventDefault();
                if (told.trim()) onAsk(`${t.scheduleTellPrefix} ${told.trim()}`);
              }}
            >
              <textarea
                value={told}
                rows={2}
                maxLength={400}
                placeholder={t.scheduleTellPlaceholder}
                aria-label={t.scheduleTellHeading}
                onChange={(event) => setTold(event.target.value)}
              />
              <button type="submit" className={styles.primary} disabled={!told.trim()}>
                <SparkleIcon aria-hidden="true" /> {t.scheduleTellSend}
              </button>
            </form>
          )}
          <p className={styles.or}>{t.scheduleOrTemplate}</p>
          <ul className={styles.templates}>
            {TEMPLATES.map((tpl) => (
              <li key={tpl.id}>
                <button
                  type="button"
                  className={styles.template}
                  onClick={() => setPreview({ name: tpl.name(), events: tpl.events() })}
                >
                  {tpl.name()}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {events !== null && (
        <Timeline
          days={shown}
          now={now}
          events={events}
          study={study}
          commitment={commitment}
          onEdit={(event, date) => setDialog({ event, date, n: Date.now() })}
          onCreate={(date, start) => setDialog({ event: null, start, weekday: weekdayOf(date), date, n: Date.now() })}
          onMove={(event, start, end) => void move(event, start, end)}
        />
      )}

      <EventDialog
        key={dialog ? `${dialog.event?.id ?? 'new'}-${dialog.n}` : 'closed'}
        open={dialog !== null}
        initial={dialog?.event ?? null}
        defaults={
          dialog && !dialog.event ? { startMinute: dialog.start ?? 480, weekdayIndex: dialog.weekday ?? 0 } : undefined
        }
        onClose={() => setDialog(null)}
        onSave={save}
        onDelete={dialog?.event ? remove : undefined}
        date={dialog?.date ?? day}
        onSkipDay={
          dialog?.event && !dialog.event.onDate
            ? async () => {
                await skipDay(dialog.event!.id, isoDay(dialog.date ?? day));
                setDialog(null);
                await refresh();
              }
            : undefined
        }
      />

      {preview && (
        <div className={styles.previewSheet} role="dialog" aria-label={preview.name}>
          <p className={styles.previewTitle}>{preview.name}</p>
          <ul>
            {preview.events.map((e, i) => (
              <li key={i}>
                <strong>{e.title}</strong> · {t.weekdays[0]}–{t.weekdays[4]} · {hhmm(e.startMinute)}–{hhmm(e.endMinute)}
              </li>
            ))}
          </ul>
          <p className={styles.previewNote}>{t.scheduleTemplateNote}</p>
          <div className={styles.previewActions}>
            <button type="button" className={styles.primary} onClick={() => void addAll()}>
              <CheckIcon aria-hidden="true" /> {t.scheduleTemplateAdd}
            </button>
            <button type="button" className={styles.quiet} onClick={() => setPreview(null)}>
              {t.cancel}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

interface TimelineProps {
  days: Date[];
  now: Date;
  events: ScheduleEvent[];
  study: StudyBlock[];
  commitment: ScheduleViewProps['commitment'];
  onEdit: (event: ScheduleEvent, date: Date) => void;
  onCreate: (date: Date, start: number) => void;
  onMove: (event: ScheduleEvent, start: number, end: number) => void;
}

interface Drag {
  event: ScheduleEvent;
  mode: 'move' | 'resize';
  y: number;
  start: number;
  end: number;
  moved: boolean;
}

function Timeline({ days, now, events, study, commitment, onEdit, onCreate, onMove }: TimelineProps) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const spans = events.map((e) => ({ start: e.startMinute, end: e.endMinute }));
  const { first, last } = hourRange(spans);
  const hours = Array.from({ length: last - first }, (_, i) => first + i);
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  const opened = useRef({ first, nowMinute });

  // Open on the current time (or the morning), not at the top of the night.
  useEffect(() => {
    const el = scroller.current;
    const { first: from, nowMinute: at } = opened.current;
    if (el) el.scrollTop = Math.max(0, (Math.max(at, 8 * 60) - from * 60 - 90) * PX);
  }, []);

  const begin = (event: ScheduleEvent, mode: Drag['mode']) => (e: ReactPointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ event, mode, y: e.clientY, start: event.startMinute, end: event.endMinute, moved: false });
  };
  const follow = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag) return;
    const delta = snap((e.clientY - drag.y) / PX);
    if (delta === 0 && !drag.moved) return;
    const length = drag.event.endMinute - drag.event.startMinute;
    if (drag.mode === 'move') {
      const start = Math.max(0, Math.min(24 * 60 - length, drag.event.startMinute + delta));
      setDrag({ ...drag, start, end: start + length, moved: true });
    } else {
      const end = Math.max(drag.event.startMinute + 15, Math.min(24 * 60, drag.event.endMinute + delta));
      setDrag({ ...drag, end, moved: true });
    }
  };
  const finish = (date: Date) => {
    if (!drag) return;
    if (drag.moved && (drag.start !== drag.event.startMinute || drag.end !== drag.event.endMinute)) {
      onMove(drag.event, drag.start, drag.end);
    } else if (!drag.moved) {
      onEdit(drag.event, date);
    }
    setDrag(null);
  };

  return (
    <div ref={scroller} className={styles.timeline} data-days={days.length}>
      <div className={styles.grid} style={{ height: hours.length * HOUR_PX }}>
        <div className={styles.axis} aria-hidden="true">
          {hours.map((h) => (
            <span key={h} style={{ top: (h - first) * HOUR_PX }}>
              {String(h).padStart(2, '0')}:00
            </span>
          ))}
        </div>
        {days.map((date) => {
          const weekday = weekdayOf(date);
          const isToday = sameDay(date, now);
          const shown = events
            .filter((e) => happensOn(e, date))
            .map((e) => (drag && drag.event.id === e.id ? { ...e, startMinute: drag.start, endMinute: drag.end } : e));
          const placed = placeLanes(shown.map((e) => ({ ...e, start: e.startMinute, end: e.endMinute })));
          const promised =
            commitment &&
            commitment.start !== null &&
            commitment.minutes !== null &&
            commitment.weekdays.includes(weekday)
              ? { start: commitment.start, end: commitment.start + commitment.minutes }
              : null;
          const studyToday = isToday ? study.filter((s) => s.at !== null) : [];
          const gaps =
            days.length === 1
              ? freeGaps(
                  placed.map((p) => p.item),
                  first,
                  last,
                  60,
                )
              : [];
          return (
            <section
              key={date.toISOString()}
              className={styles.column}
              aria-label={date.toLocaleDateString(uiLanguage, { weekday: 'long', day: 'numeric', month: 'long' })}
              onPointerMove={follow}
              onPointerUp={() => finish(date)}
              onPointerCancel={() => setDrag(null)}
              onClick={(e) => {
                if (e.target !== e.currentTarget) return;
                const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                onCreate(date, snap(first * 60 + y / PX));
              }}
            >
              {hours.map((h) => (
                <span key={h} className={styles.hourLine} style={{ top: (h - first) * HOUR_PX }} aria-hidden="true" />
              ))}
              {gaps.map((g) => (
                <span key={g.start} className={styles.gap} style={{ top: ((g.start + g.end) / 2 - first * 60) * PX }}>
                  {t.scheduleFree(hhmm(g.start), hhmm(g.end))}
                </span>
              ))}
              {promised && studyToday.length === 0 && (
                <span className={styles.promised} style={blockGeometry(promised.start, promised.end, first)}>
                  {t.scheduleStudyTime(hhmm(promised.start))}
                </span>
              )}
              {placed.map(({ item: e, lane, lanes }) => {
                const { top, height } = blockGeometry(e.startMinute, e.endMinute, first);
                return (
                  <button
                    key={e.id}
                    type="button"
                    className={styles.event}
                    data-kind={e.kind}
                    data-dragging={drag?.event.id === e.id || undefined}
                    style={{
                      top,
                      height,
                      left: `calc(${(lane / lanes) * 100}% + 2px)`,
                      width: `calc(${100 / lanes}% - 4px)`,
                    }}
                    onPointerDown={begin(e, 'move')}
                    onKeyDown={(k) => {
                      if (k.key === 'Enter' || k.key === ' ') {
                        k.preventDefault();
                        onEdit(e, date);
                      }
                    }}
                    aria-label={`${e.title}, ${hhmm(e.startMinute)}–${hhmm(e.endMinute)}`}
                  >
                    <span className={styles.eventTitle}>{e.title}</span>
                    <span className={styles.eventTime}>
                      {hhmm(e.startMinute)}–{hhmm(e.endMinute)}
                    </span>
                    <span className={styles.resize} onPointerDown={begin(e, 'resize')} aria-hidden="true" />
                  </button>
                );
              })}
              {studyToday.length > 0 &&
                (() => {
                  // Today's tasks run back to back: one block for them, started from the first.
                  const start = studyToday[0].at!;
                  const end = Math.max(...studyToday.map((s) => s.at! + s.minutes));
                  const { top, height } = blockGeometry(start, end, first);
                  return (
                    <div className={styles.study} style={{ top, minHeight: height }}>
                      <span className={styles.studyText}>
                        {hhmm(start)}–{hhmm(end)} · {studyToday.map((s) => s.title).join(', ')}
                      </span>
                      <button type="button" className={styles.studyStart} onClick={studyToday[0].onStart}>
                        {t.scheduleStart}
                      </button>
                    </div>
                  );
                })()}
              {isToday && nowMinute >= first * 60 && nowMinute <= last * 60 && (
                <span
                  className={styles.now}
                  style={{ top: (nowMinute - first * 60) * PX }}
                  role="img"
                  aria-label={t.scheduleNow(hhmm(nowMinute))}
                />
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
