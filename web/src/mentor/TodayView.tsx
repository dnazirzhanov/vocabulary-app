/**
 * The mentor's home, «Сегодня» (ADR 0071): a to-do list led by what to do now. Weighed against
 * nine other shapes (a timeline, kanban, a card stack, a quest path, tiles, chat-first, a habit
 * grid, a morning/day/evening agenda, a lone focus card), this one reads in one glance on a phone,
 * has one obvious action, and ties each task to a time from the learner's own day.
 *
 * Top to bottom: the goal and whether it is on track; «Сейчас» with one button; today's checklist
 * with times; the week's targets and promised days; the promised study time; the weekly
 * adjustment when there is one; and a bar to ask the mentor.
 */
import type { CSSProperties } from 'react';
import type { Coach } from '../lib/api.ts';
import { t, uiLanguage } from '../i18n/index.ts';
import {
  BookIcon,
  CalendarIcon,
  CardsIcon,
  CheckIcon,
  ForwardIcon,
  MarkerIcon,
  MicIcon,
  PencilIcon,
  SparkleIcon,
} from '../ui/icons.tsx';
import { hhmm } from './chat/format.ts';
import { skillName, statusText } from './chat/ToolCards.tsx';
import type { PlanItem } from './types.ts';
import styles from './TodayView.module.css';

export interface Slotted {
  item: PlanItem;
  key: string;
  /** When to do it today (minutes from midnight), or null when it no longer fits. */
  at: number | null;
}

interface TodayViewProps {
  greeting: string;
  coach: Coach | null;
  goalLabel: string | null;
  tasks: Slotted[];
  done: PlanItem[];
  /** The block the learner is in now, and until when they are free otherwise. */
  busy: { title: string; end: number } | null;
  freeUntil: number;
  /** The time now, minutes from midnight. */
  minute: number;
  tip: string;
  busyStarting: boolean;
  onStart: (item: PlanItem) => void;
  onAsk: (question?: string) => void;
  onOpenCalendar: () => void;
  onEditGoal: () => void;
  onDecide: (accept: boolean) => void;
}

const icon = (item: PlanItem) =>
  item.kind === 'vocab' ? (
    <CardsIcon />
  ) : item.kind === 'spelling' ? (
    <MarkerIcon />
  ) : item.kind === 'reading' ? (
    <BookIcon />
  ) : item.kind === 'writing' ? (
    <PencilIcon />
  ) : (
    <MicIcon />
  );

export function titleOf(item: PlanItem): string {
  if (item.kind === 'vocab') return t.mentorPlanVocabTitle(item.title);
  if (item.kind === 'spelling') return t.mentorPlanSpellingTitle(item.title);
  if (item.kind === 'reading') return t.mentorPlanReadingTitle(item.title);
  return item.title;
}

const meta = (s: Slotted) =>
  [t.mentorMinutesShort(s.item.minutes), s.at === null ? null : hhmm(s.at)].filter(Boolean).join(' · ');

const days = (list: number[]) =>
  list.length === 7
    ? t.mentorEveryDay
    : list.length === 5 && list.every((d, i) => d === i)
      ? `${t.weekdays[0]}–${t.weekdays[4]}`
      : list.map((d) => t.weekdays[d]).join(', ');

function adjustmentText(a: NonNullable<Coach['adjustment']>): string {
  const e = a.evidence;
  const p = a.proposal;
  switch (a.kind) {
    case 'easier_minutes':
      return t.mentorAdjustEasier(e.kept ?? 0, e.promised ?? 0, p.minutes ?? 0);
    case 'fewer_days':
      return t.mentorAdjustFewerDays(e.kept ?? 0, e.promised ?? 0, p.days ?? 0);
    case 'move_time':
      return t.mentorAdjustMoveTime(hhmm(e.usual_start ?? 0), hhmm(p.start ?? 0));
    case 'more_minutes':
      return t.mentorAdjustMore(p.minutes ?? 0);
    case 'behind':
      return t.mentorAdjustBehind;
  }
}

export function TodayView(props: TodayViewProps) {
  const { coach, tasks, done, busy } = props;
  const next = tasks.find((s) => s.item) ?? null;
  const total = tasks.length + done.length;
  const left = tasks.reduce((sum, s) => sum + s.item.minutes, 0);
  const share = total ? done.length / total : 0;
  const commitment = coach?.commitment;
  const date = new Date().toLocaleDateString(uiLanguage, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className={styles.column}>
      <header className={styles.head}>
        <p className={styles.date}>{date}</p>
        <h1 className={styles.greeting} tabIndex={-1} data-autofocus>
          {props.greeting}
        </h1>
      </header>

      {/* The goal, and honestly whether it is on track. */}
      {props.goalLabel ? (
        <button type="button" className={styles.goal} onClick={props.onEditGoal}>
          <span className={styles.goalText}>{props.goalLabel}</span>
          {coach?.feasibility && (
            <span className={styles.goalStatus} data-status={coach.feasibility.status}>
              {statusText(coach.feasibility.status)}
            </span>
          )}
          <span className={styles.change}>{t.mentorChange}</span>
        </button>
      ) : (
        <section className={styles.setGoal}>
          <h2>{t.mentorSetGoalCta}</h2>
          <p>{t.mentorSetGoalLead}</p>
          <button type="button" className={styles.primary} onClick={() => props.onAsk(t.mentorAskGoal)}>
            {t.mentorSetGoalWithMentor}
          </button>
        </section>
      )}

      {/* Now: one thing, one button. */}
      <section className={styles.now} aria-labelledby="mentor-now">
        <h2 id="mentor-now" className={styles.nowLabel}>
          {t.mentorNow}
        </h2>
        {busy ? (
          <p className={styles.nowBusy}>
            {t.mentorBusyUntil(busy.title, hhmm(busy.end))}
            {next?.at != null && <span> · {t.mentorNextWindow(hhmm(next.at))}</span>}
          </p>
        ) : next ? (
          <div className={styles.nowTask}>
            <span className={styles.nowIcon} aria-hidden="true">
              {icon(next.item)}
            </span>
            <div className={styles.nowBody}>
              <p className={styles.nowTitle}>{titleOf(next.item)}</p>
              <p className={styles.nowMeta}>
                {t.mentorMinutesShort(next.item.minutes)} ·{' '}
                {/* Planned later today: say when; it can still be done now. */}
                {next.at !== null && next.at > props.minute + 5
                  ? t.mentorPlannedAt(hhmm(next.at))
                  : t.mentorFreeUntil(hhmm(props.freeUntil))}
              </p>
            </div>
            <button
              type="button"
              className={styles.primary}
              disabled={props.busyStarting}
              onClick={() => props.onStart(next.item)}
            >
              {t.mentorStartNow}
              <ForwardIcon aria-hidden="true" />
            </button>
          </div>
        ) : (
          <p className={styles.nowDone}>
            <CheckIcon aria-hidden="true" /> {t.mentorAllDone}
          </p>
        )}
      </section>

      {/* Today's checklist, with times from the learner's day. */}
      <section aria-labelledby="mentor-plan-heading">
        <div className={styles.sectionHead}>
          <h2 id="mentor-plan-heading" className={styles.sectionTitle}>
            {t.mentorPlanHeading}
          </h2>
          {total > 0 && (
            <span className={styles.ring} style={{ '--share': share } as CSSProperties}>
              {t.mentorPlanProgress(done.length, total, left)}
            </span>
          )}
        </div>
        {total === 0 ? (
          <p className={styles.muted}>{t.mentorPlanEmpty}</p>
        ) : (
          <ul className={styles.checklist}>
            {tasks.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  className={styles.task}
                  disabled={props.busyStarting}
                  onClick={() => props.onStart(s.item)}
                >
                  <span className={styles.check} aria-hidden="true" />
                  <span className={styles.taskText}>
                    <span className={styles.taskTitle}>{titleOf(s.item)}</span>
                    <span className={styles.taskMeta}>{meta(s)}</span>
                  </span>
                  <ForwardIcon className={styles.chevron} aria-hidden="true" />
                </button>
              </li>
            ))}
            {done.map((item, i) => (
              <li key={`done-${i}`}>
                <p className={styles.task} data-done>
                  <span className={styles.check} aria-hidden="true">
                    <CheckIcon />
                  </span>
                  <span className={styles.taskText}>
                    <span className={styles.taskTitle}>{titleOf(item)}</span>
                    <span className={styles.visuallyHidden}>{t.done}</span>
                  </span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* The weekly look back's one proposal. */}
      {coach?.adjustment && (
        <section className={styles.adjust} aria-labelledby="mentor-adjust">
          <h2 id="mentor-adjust" className={styles.sectionTitle}>
            <SparkleIcon aria-hidden="true" /> {t.mentorAdjustHeading}
          </h2>
          <p>{adjustmentText(coach.adjustment)}</p>
          <div className={styles.adjustActions}>
            {coach.adjustment.kind === 'behind' ? (
              <button type="button" className={styles.primary} onClick={() => props.onAsk(t.mentorAskWeek)}>
                {t.mentorDiscuss}
              </button>
            ) : (
              <button type="button" className={styles.primary} onClick={() => props.onDecide(true)}>
                {t.mentorAccept}
              </button>
            )}
            <button type="button" className={styles.quiet} onClick={() => props.onDecide(false)}>
              {t.mentorNotNow}
            </button>
          </div>
        </section>
      )}

      {/* This week: the goal's targets and the promised days. */}
      {coach && coach.targets.length > 0 && (
        <section aria-labelledby="mentor-week">
          <h2 id="mentor-week" className={styles.sectionTitle}>
            {t.mentorThisWeek}
          </h2>
          <ul className={styles.targets}>
            {coach.targets.map((target) => (
              <li key={target.skill}>
                <span>{skillName(target.skill)}</span>
                <span className={styles.bar} aria-hidden="true">
                  <span style={{ width: `${Math.min(100, (target.done / Math.max(1, target.planned)) * 100)}%` }} />
                </span>
                <span className={styles.count}>
                  {target.done}/{target.planned}
                </span>
              </li>
            ))}
          </ul>
          <ol
            className={styles.days}
            aria-label={t.mentorWeekDays(coach.studied.filter(Boolean).length, coach.promised.filter(Boolean).length)}
          >
            {coach.promised.map((promised, d) => (
              <li key={d} data-state={coach.studied[d] ? 'done' : promised ? 'promised' : 'off'} aria-hidden="true">
                <span>{t.weekdays[d]}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* The promise with its time. */}
      <section className={styles.commitment} aria-labelledby="mentor-time">
        <h2 id="mentor-time" className={styles.sectionTitle}>
          {t.mentorStudyTime}
        </h2>
        {commitment && commitment.start_minute !== null && commitment.minutes !== null ? (
          <button type="button" className={styles.timeRow} onClick={() => props.onAsk(t.mentorAskTime)}>
            <strong>{hhmm(commitment.start_minute)}</strong>
            <span>
              {days(commitment.weekdays)} · {t.mentorMinutesShort(commitment.minutes)}
            </span>
            <span className={styles.change}>{t.mentorChange}</span>
          </button>
        ) : (
          <button type="button" className={styles.timeRow} onClick={() => props.onAsk(t.mentorAskTime)}>
            <span>{t.mentorPickTime}</span>
            <ForwardIcon aria-hidden="true" />
          </button>
        )}
        <button type="button" className={styles.calendarRow} onClick={props.onOpenCalendar}>
          <CalendarIcon aria-hidden="true" />
          <span>{t.scheduleHeading}</span>
          <ForwardIcon aria-hidden="true" />
        </button>
      </section>

      <p className={styles.tip}>
        <SparkleIcon aria-hidden="true" /> {props.tip}
      </p>

      <button type="button" className={styles.askBar} onClick={() => props.onAsk()}>
        {t.mentorAskBar}
      </button>
    </div>
  );
}
