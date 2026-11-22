/**
 * The mentor's components (ADR 0077): drawn in the app's own design from cards the server filled
 * in and checked. Each does one thing: shows today, warms up words, asks what kind of day it is,
 * asks one question, or celebrates something real.
 */
import { useState } from 'react';
import { api, type MentorCard, type MentorPlanItem } from '../../lib/api.ts';
import type { NotificationChoice } from '../../lib/types.ts';
import { t, uiLanguage } from '../../i18n/index.ts';
import { CheckIcon, ForwardIcon, SparkleIcon } from '../../ui/icons.tsx';
import { isoDay } from '../../schedule/types.ts';
import { DAY_TYPES, loadFor, type DayType } from '../dayPlan.ts';
import { slotsFor } from '../slots.ts';
import { dayTypeName } from '../TodayView.tsx';
import { hhmm } from './format.ts';
import type { Activity } from './ToolCards.tsx';
import styles from './GenCards.module.css';

type Card<K extends MentorCard['type']> = Extract<MentorCard, { type: K }>;

/** A plan task as the activity the chat's cards start. */
export const activityOf = (item: MentorPlanItem): Activity => ({
  type: 'activity',
  kind: item.kind,
  deck_id: item.deckId ?? null,
  article_id: item.articleId ?? null,
  title: item.title,
  minutes: item.minutes,
  count: item.count ?? null,
  why: null,
});

/** Today's plan beside the chat on a wide screen (ADR 0077); it follows what the chat applies. */
export function PlanPanel({
  plan,
  onStart,
}: {
  plan: MentorPlanItem[];
  onStart: (activity: Activity) => Promise<void> | void;
}) {
  return (
    <aside className={styles.panel} aria-labelledby="plan-panel">
      <h2 id="plan-panel" className={styles.panelTitle}>
        {t.mentorPlanHeading}
      </h2>
      {plan.length ? (
        <ol className={styles.panelList}>
          {plan.map((item, i) => (
            <li key={i}>
              <span className={styles.panelText}>
                <strong>{item.title}</strong>
                <span>{t.mentorMinutesShort(item.minutes)}</span>
              </span>
              <button
                type="button"
                className={styles.panelStart}
                aria-label={`${t.mentorStartNow}: ${item.title}`}
                onClick={() => void onStart(activityOf(item))}
              >
                <ForwardIcon aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.muted}>{t.mentorAllDone}</p>
      )}
    </aside>
  );
}

/** Something the mentor changed for the learner: the home reloads its plan. */
export const announceChange = () => window.dispatchEvent(new Event('mentor:changed'));

const FROM = 7 * 60;
const TO = 23 * 60;
const at = (minute: number) => `${(100 * (Math.min(TO, Math.max(FROM, minute)) - FROM)) / (TO - FROM)}%`;

/** Today on one line: the day's blocks, the plan's tasks in the free time, and now. */
export function DayCard({ card, plan }: { card: Card<'day'>; plan: MentorPlanItem[] }) {
  const now = new Date();
  const minute = now.getHours() * 60 + now.getMinutes();
  const isToday = card.date === isoDay(now);
  const tasks = isToday ? loadFor(card.day_type, plan) : [];
  const busy = card.blocks.map((b) => ({ start: b.start_minute, end: b.end_minute }));
  const starts = slotsFor(tasks, busy, minute, card.study_start);
  const rows = [
    ...card.blocks.map((b) => ({ at: b.start_minute, end: b.end_minute, title: b.title, kind: b.kind })),
    ...tasks.flatMap((task, i) =>
      starts[i] === null
        ? []
        : [{ at: starts[i] as number, end: (starts[i] as number) + task.minutes, title: task.title, kind: 'study' }],
    ),
  ].sort((a, b) => a.at - b.at);
  return (
    <div className={styles.card}>
      <p className={styles.head}>
        {t.mentorGenDay}
        {!isToday && (
          <span className={styles.muted}>
            {' · '}
            {new Date(`${card.date}T12:00:00`).toLocaleDateString(uiLanguage, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </span>
        )}
        {card.day_type && <span className={styles.muted}> · {dayTypeName(card.day_type)}</span>}
      </p>
      <div className={styles.strip} aria-hidden="true">
        {rows.map((row, i) => (
          <span
            key={i}
            className={styles.segment}
            data-kind={row.kind}
            style={{ left: at(row.at), width: `calc(${at(row.end)} - ${at(row.at)})` }}
          />
        ))}
        {isToday && minute >= FROM && minute <= TO && <span className={styles.now} style={{ left: at(minute) }} />}
      </div>
      <div className={styles.scale} aria-hidden="true">
        <span>07:00</span>
        <span>15:00</span>
        <span>23:00</span>
      </div>
      {rows.length ? (
        <ol className={styles.rows}>
          {rows.map((row, i) => (
            <li key={i} data-kind={row.kind}>
              <time>
                {hhmm(row.at)}–{hhmm(row.end)}
              </time>
              <span>{row.title}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.muted}>{t.mentorGenDayEmpty}</p>
      )}
    </div>
  );
}

/** Recall before the real review: tap a word to check its meaning. Nothing here is graded. */
export function WordsCard({
  card,
  plan,
  onStart,
}: {
  card: Card<'words'>;
  plan: MentorPlanItem[];
  onStart: (activity: Activity) => Promise<void> | void;
}) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const review = plan.find((item) => item.kind === 'vocab' && item.deckId);
  return (
    <div className={styles.card}>
      <p className={styles.head}>{t.mentorGenWords}</p>
      <p className={styles.muted}>{t.mentorGenWordsHint}</p>
      <ul className={styles.words}>
        {card.words.map((word, i) => (
          <li key={i}>
            <button
              type="button"
              className={styles.word}
              aria-pressed={open.has(i)}
              onClick={() => setOpen((was) => new Set(was).add(i))}
            >
              <strong lang="en">{word.en}</strong>
              <span>{open.has(i) ? word.l1 : '···'}</span>
            </button>
          </li>
        ))}
      </ul>
      {review && (
        <button type="button" className={styles.primary} onClick={() => void onStart(activityOf(review))}>
          {t.mentorGenWordsReview(card.due)}
        </button>
      )}
    </div>
  );
}

/** What kind of day it is, answered in the chat; the home follows. */
export function DayCheckCard({ card }: { card: Card<'day_check'> }) {
  const [picked, setPicked] = useState<DayType | null>(card.current);
  const [saving, setSaving] = useState(false);
  const pick = (type: DayType) => {
    setSaving(true);
    api.coachDayType(type).then(
      () => {
        setPicked(type);
        setSaving(false);
        announceChange();
      },
      () => setSaving(false),
    );
  };
  return (
    <div className={styles.card}>
      <p className={styles.head}>{t.mentorDayTypeAsk}</p>
      <div className={styles.chips} role="group" aria-label={t.mentorDayTypeAsk}>
        {DAY_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className={styles.chip}
            aria-pressed={picked === type}
            disabled={saving}
            onClick={() => pick(type)}
          >
            {picked === type && <CheckIcon aria-hidden="true" />}
            {dayTypeName(type)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** One question; the tapped answer is sent as the learner's own message. */
export function ChoiceCard({ card, onSend }: { card: Card<'choice'>; onSend?: (text: string) => void }) {
  const [sent, setSent] = useState<string | null>(null);
  return (
    <div className={styles.card}>
      <p className={styles.head}>{card.question}</p>
      <div className={styles.chips}>
        {card.options.map((option) => (
          <button
            key={option}
            type="button"
            className={styles.chip}
            aria-pressed={sent === option}
            disabled={sent !== null || !onSend}
            onClick={() => {
              setSent(option);
              onSend?.(option);
            }}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

const MILESTONE: Record<Card<'celebrate'>['milestones'][number]['kind'], (n: number) => string> = {
  streak_weeks: (n) => t.mentorGenStreak(n),
  days_this_week: (n) => t.mentorGenDaysThisWeek(n),
  words_known: (n) => t.mentorGenWordsKnown(n),
};

/** Real milestones only: the server counts them. */
export function CelebrateCard({ card }: { card: Card<'celebrate'> }) {
  return (
    <div className={styles.card} data-tone="celebrate">
      <p className={styles.head}>
        <SparkleIcon aria-hidden="true" /> {t.mentorGenCelebrate}
      </p>
      <ul className={styles.milestones}>
        {card.milestones.map((m) => (
          <li key={m.kind}>{MILESTONE[m.kind](m.value)}</li>
        ))}
      </ul>
    </div>
  );
}

/** While a component is being made: its shape, so the answer doesn't jump when it arrives. */
export function CardSkeleton() {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

const REMINDER_NAME: Record<'morning' | 'afternoon' | 'deadline' | 'report', () => string> = {
  morning: () => t.inTheMorningTodaySPromise,
  afternoon: () => t.at1700IfYouHaven,
  deadline: () => t.deckDeadline,
  report: () => t.theGroupSReportForYesterday,
};

/** Reminders turned on or off (ADR 0079): only what changes, saved on the tap like in Settings. */
export function RemindersCard({ card }: { card: Card<'reminders'> }) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const changes = Object.entries(card.changes) as ['morning' | 'afternoon' | 'deadline' | 'report', boolean][];
  const save = () => {
    setState('saving');
    const update = Object.fromEntries(changes.map(([kind, on]) => [`notify_${kind}`, on])) as Partial<
      Record<NotificationChoice, boolean>
    >;
    api.updateMe(update).then(
      () => setState('saved'),
      () => setState('failed'),
    );
  };
  return (
    <div className={styles.card}>
      <p className={styles.head}>{t.mentorRemindersTitle}</p>
      <ul className={styles.rows}>
        {changes.map(([kind, on]) => (
          <li key={kind} data-kind={on ? 'study' : 'other'}>
            <span>{on ? t.mentorReminderOn : t.mentorReminderOff}</span>
            <span>{REMINDER_NAME[kind]()}</span>
          </li>
        ))}
      </ul>
      {state === 'saved' ? (
        <p className={styles.muted} role="status">
          <CheckIcon aria-hidden="true" /> {t.mentorRemindersSaved}
        </p>
      ) : (
        <button type="button" className={styles.primary} disabled={state === 'saving'} onClick={save}>
          {t.mentorRemindersApply}
        </button>
      )}
      {state === 'failed' && (
        <p className={styles.muted} role="alert">
          {t.scheduleSaveFailed}
        </p>
      )}
    </div>
  );
}
