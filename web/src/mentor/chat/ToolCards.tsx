/**
 * What the mentor did before answering (ADR 0072): each tool as a step, and its card. Cards act
 * only on a tap: «Начать сейчас» opens the activity; a schedule, a study time or a goal is saved
 * only when the learner confirms it here.
 */
import { useState } from 'react';
import { api, describeError, type MentorCard, type MentorToolName } from '../../lib/api.ts';
import { createEvent, skipDay } from '../../schedule/api.ts';
import type { EventKind } from '../../schedule/types.ts';
import { t, uiLanguage } from '../../i18n/index.ts';
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
} from '../../ui/icons.tsx';
import { hhmm } from './format.ts';
import styles from './Chat.module.css';

export type Activity = Extract<MentorCard, { type: 'activity' }>;

const STEP_LABEL: Record<MentorToolName, () => string> = {
  what_now: () => t.mentorToolWhatNow,
  suggest_activity: () => t.mentorToolSuggest,
  get_week_plan: () => t.mentorToolWeek,
  propose_goal: () => t.mentorToolGoal,
  propose_schedule: () => t.mentorToolSchedule,
  propose_study_times: () => t.mentorToolTimes,
  propose_exception: () => t.mentorToolException,
  offer_replies: () => '',
  remember: () => t.mentorToolRemember,
  recall: () => t.mentorToolRecall,
};

export function ToolStep({ name, done }: { name: MentorToolName; done: boolean }) {
  return (
    <p className={styles.step} data-done={done || undefined} role="status">
      <span className={styles.stepIcon} aria-hidden="true">
        {done ? <CheckIcon /> : <span className={styles.spinner} />}
      </span>
      {STEP_LABEL[name]?.() ?? name}
      {done ? '' : '…'}
    </p>
  );
}

interface CardProps {
  card: MentorCard;
  onStart: (activity: Activity) => Promise<void> | void;
}

export function ToolCard({ card, onStart }: CardProps) {
  switch (card.type) {
    case 'activity':
      return <ActivityCard activity={card} onStart={onStart} />;
    case 'busy':
      return (
        <div className={styles.card}>
          <p className={styles.cardLine}>
            {t.mentorBusyUntil(card.busy_with ?? '', card.until === null ? '' : hhmm(card.until))}
          </p>
        </div>
      );
    case 'done':
      return (
        <div className={styles.card} data-tone="done">
          <p className={styles.cardLine}>
            <CheckIcon aria-hidden="true" /> {t.mentorAllDone}
          </p>
        </div>
      );
    case 'schedule':
      return <ScheduleCard events={card.events} />;
    case 'study_times':
      return <StudyTimesCard options={card.options} />;
    case 'goal':
      return <GoalCard goal={card} />;
    case 'week':
      return <WeekCard week={card} />;
    case 'exception':
      return <ExceptionCard change={card} />;
    case 'replies':
      return null; // shown as chips under the answer
    case 'memory':
      return <MemoryChip fact={card} />;
  }
}

function activityIcon(kind: Activity['kind']) {
  if (kind === 'vocab') return <CardsIcon />;
  if (kind === 'spelling') return <MarkerIcon />;
  if (kind === 'reading') return <BookIcon />;
  if (kind === 'writing') return <PencilIcon />;
  return <MicIcon />;
}

function activityTitle(a: Activity): string {
  if (a.kind === 'vocab') return t.mentorPlanVocabTitle(a.title ?? '');
  if (a.kind === 'spelling') return t.mentorPlanSpellingTitle(a.title ?? '');
  if (a.kind === 'reading') return t.mentorPlanReadingTitle(a.title ?? '');
  if (a.kind === 'writing') return t.mentorActivityWriting;
  return t.mentorActivitySpeaking;
}

function ActivityCard({ activity, onStart }: { activity: Activity; onStart: CardProps['onStart'] }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className={styles.card} data-tone="activity">
      <span className={styles.cardIcon} aria-hidden="true">
        {activityIcon(activity.kind)}
      </span>
      <div className={styles.cardBody}>
        <p className={styles.cardTitle}>{activityTitle(activity)}</p>
        <p className={styles.cardMeta}>
          {[activity.minutes ? t.mentorMinutesShort(activity.minutes) : null, activity.why].filter(Boolean).join(' · ')}
        </p>
      </div>
      <button
        type="button"
        className={styles.startButton}
        disabled={busy}
        aria-busy={busy}
        onClick={() => {
          setBusy(true);
          void Promise.resolve(onStart(activity)).finally(() => setBusy(false));
        }}
      >
        {t.mentorStartNow}
        <ForwardIcon aria-hidden="true" />
      </button>
    </div>
  );
}

const dayNames = (days: number[]) => (days.length === 7 ? t.mentorEveryDay : days.map((d) => t.weekdays[d]).join(', '));

function ScheduleCard({ events }: { events: Extract<MentorCard, { type: 'schedule' }>['events'] }) {
  const [chosen, setChosen] = useState(() => events.map(() => true));
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    setState('saving');
    setProblem(null);
    try {
      for (const [i, e] of events.entries()) {
        if (!chosen[i]) continue;
        await createEvent({
          title: e.title,
          kind: e.kind as EventKind,
          weekdays: e.weekdays.reduce((mask, d) => mask | (1 << d), 0),
          startMinute: e.start_minute,
          endMinute: e.end_minute,
        });
      }
      setState('saved');
    } catch (caught) {
      setProblem(describeError(caught));
      setState('idle');
    }
  };
  return (
    <div className={styles.card} data-tone="proposal">
      <p className={styles.cardHead}>
        <CalendarIcon aria-hidden="true" /> {t.mentorScheduleProposal}
      </p>
      <ul className={styles.proposalList}>
        {events.map((e, i) => (
          <li key={i}>
            <label className={styles.proposalRow}>
              <input
                type="checkbox"
                checked={chosen[i]}
                disabled={state !== 'idle'}
                onChange={() => setChosen((c) => c.map((v, j) => (j === i ? !v : v)))}
              />
              <span className={styles.proposalTitle}>{e.title}</span>
              <span className={styles.proposalMeta}>
                {dayNames(e.weekdays)} · {hhmm(e.start_minute)}–{hhmm(e.end_minute)}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {problem && (
        <p className={styles.cardProblem} role="alert">
          {problem}
        </p>
      )}
      {state === 'saved' ? (
        <p className={styles.saved} role="status">
          <CheckIcon aria-hidden="true" /> {t.mentorScheduleAdded}
        </p>
      ) : (
        <button
          type="button"
          className={styles.confirmButton}
          disabled={state === 'saving' || !chosen.some(Boolean)}
          onClick={() => void save()}
        >
          {t.mentorScheduleAdd}
        </button>
      )}
    </div>
  );
}

type StudyOption = Extract<MentorCard, { type: 'study_times' }>['options'][number];

const REASON: Record<string, (o: StudyOption) => string> = {
  works: (o) => t.mentorReasonWorks(o.kept ?? 0, o.tried ?? 0),
  habit: () => t.mentorReasonHabit,
  preferred: () => t.mentorReasonPreferred,
  after_block: () => t.mentorReasonAfterBlock,
};

function StudyTimesCard({ options }: { options: Extract<MentorCard, { type: 'study_times' }>['options'] }) {
  const [picked, setPicked] = useState(0);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const promise = async () => {
    const option = options[picked];
    setState('saving');
    setProblem(null);
    try {
      await api.coachCommit(option.weekdays, option.start_minute, option.minutes);
      setState('saved');
    } catch (caught) {
      setProblem(describeError(caught));
      setState('idle');
    }
  };
  const chosen = options[picked];
  return (
    <div className={styles.card} data-tone="proposal">
      <p className={styles.cardHead}>
        <SparkleIcon aria-hidden="true" /> {t.mentorStudyTimesProposal}
      </p>
      <div className={styles.options} role="radiogroup" aria-label={t.mentorStudyTimesProposal}>
        {options.map((o, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={picked === i}
            className={styles.option}
            disabled={state !== 'idle'}
            onClick={() => setPicked(i)}
          >
            <strong>{hhmm(o.start_minute)}</strong>
            <span>{t.mentorMinutesShort(o.minutes)}</span>
            <small>
              {o.reasons
                .filter((r) => r in REASON)
                .map((r) => REASON[r](o))
                .join(' · ') || t.mentorReasonFree}
            </small>
          </button>
        ))}
      </div>
      <p className={styles.cardMeta}>{dayNames(chosen.weekdays)}</p>
      {problem && (
        <p className={styles.cardProblem} role="alert">
          {problem}
        </p>
      )}
      {state === 'saved' ? (
        <p className={styles.saved} role="status">
          <CheckIcon aria-hidden="true" /> {t.mentorPromised(hhmm(chosen.start_minute), chosen.minutes)}
        </p>
      ) : (
        <button
          type="button"
          className={styles.confirmButton}
          disabled={state === 'saving'}
          onClick={() => void promise()}
        >
          {t.mentorPromise(hhmm(chosen.start_minute))}
        </button>
      )}
    </div>
  );
}

const GOAL_KIND: Record<string, () => string> = {
  ielts: () => t.mentorGoalTypeIelts,
  conversation: () => t.mentorGoalTypeConversation,
  travel: () => t.mentorGoalTypeTravel,
  business: () => t.mentorGoalTypeBusiness,
  academic: () => t.mentorGoalTypeAcademic,
  general: () => t.mentorGoalTypeGeneral,
};

export function statusText(status: string): string {
  return (
    {
      on_track: t.mentorStatusOnTrack,
      tight: t.mentorStatusTight,
      not_possible: t.mentorStatusNotPossible,
      open: t.mentorStatusOpen,
      reached: t.mentorStatusReached,
    }[status] ?? ''
  );
}

const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(uiLanguage, { day: 'numeric', month: 'long', year: 'numeric' });

function GoalCard({ goal }: { goal: Extract<MentorCard, { type: 'goal' }> }) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    setState('saving');
    setProblem(null);
    try {
      await api.coachSetGoal({
        kind: goal.kind,
        target: goal.target,
        deadline: goal.deadline,
        why: goal.why,
        start_level: goal.start_level as never,
      });
      setState('saved');
    } catch (caught) {
      setProblem(describeError(caught));
      setState('idle');
    }
  };
  const heading = [
    GOAL_KIND[goal.kind]?.(),
    goal.target,
    goal.deadline ? t.mentorGoalBy(longDate(goal.deadline)) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className={styles.card} data-tone="proposal" data-status={goal.status}>
      <p className={styles.cardHead}>{heading}</p>
      <p className={styles.status} data-status={goal.status}>
        {statusText(goal.status)}
      </p>
      {(goal.status === 'not_possible' || goal.status === 'tight') && goal.minutes_a_day_needed !== null && (
        <p className={styles.cardMeta}>{t.mentorGoalNeeds(goal.minutes_a_day_needed)}</p>
      )}
      {goal.reached_by && goal.status !== 'on_track' && (
        <p className={styles.cardMeta}>{t.mentorGoalReachedBy(longDate(goal.reached_by))}</p>
      )}
      {goal.why && <p className={styles.cardMeta}>«{goal.why}»</p>}
      {problem && (
        <p className={styles.cardProblem} role="alert">
          {problem}
        </p>
      )}
      {state === 'saved' ? (
        <p className={styles.saved} role="status">
          <CheckIcon aria-hidden="true" /> {t.mentorGoalConfirmed}
        </p>
      ) : (
        <button
          type="button"
          className={styles.confirmButton}
          disabled={state === 'saving'}
          onClick={() => void save()}
        >
          {t.mentorGoalConfirm}
        </button>
      )}
    </div>
  );
}

export const skillName = (skill: string): string =>
  ({
    words: t.mentorSkillWords,
    reading: t.mentorSkillReading,
    writing: t.mentorSkillWriting,
    speaking: t.mentorSkillSpeaking,
  })[skill] ?? skill;

function WeekCard({ week }: { week: Extract<MentorCard, { type: 'week' }> }) {
  return (
    <div className={styles.card}>
      {week.status && (
        <p className={styles.status} data-status={week.status}>
          {statusText(week.status)}
        </p>
      )}
      <ul className={styles.targets}>
        {week.targets.map((target) => (
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
      {week.study_time && week.minutes && (
        <p className={styles.cardMeta}>{t.mentorStudyTimeLine(week.study_time, week.minutes)}</p>
      )}
    </div>
  );
}

const fullDay = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(uiLanguage, { weekday: 'long', day: 'numeric', month: 'long' });

/** A day that is different (ADR 0074): applied only on the tap. */
function ExceptionCard({ change }: { change: Extract<MentorCard, { type: 'exception' }> }) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [problem, setProblem] = useState<string | null>(null);
  const apply = async () => {
    setState('saving');
    setProblem(null);
    try {
      if (change.kind === 'skip_day') {
        for (const event of change.events ?? []) await skipDay(event.id, change.date);
      } else if (change.kind === 'one_off') {
        await createEvent({
          title: change.title ?? '',
          kind: 'other',
          weekdays: 1 << ((new Date(`${change.date}T12:00:00`).getDay() + 6) % 7),
          startMinute: change.start_minute ?? 0,
          endMinute: change.end_minute ?? 0,
          onDate: change.date,
        });
      } else {
        await api.promisePause(change.until ?? change.date);
      }
      setState('saved');
    } catch (caught) {
      setProblem(describeError(caught));
      setState('idle');
    }
  };
  const text =
    change.kind === 'skip_day'
      ? t.mentorExceptionSkip((change.events ?? []).map((e) => e.title).join(', '), fullDay(change.date))
      : change.kind === 'one_off'
        ? t.mentorExceptionOneOff(
            change.title ?? '',
            fullDay(change.date),
            `${hhmm(change.start_minute ?? 0)}–${hhmm(change.end_minute ?? 0)}`,
          )
        : t.mentorExceptionPause(fullDay(change.date), fullDay(change.until ?? change.date));
  return (
    <div className={styles.card} data-tone="proposal">
      <p className={styles.cardHead}>
        <CalendarIcon aria-hidden="true" /> {text}
      </p>
      {problem && (
        <p className={styles.cardProblem} role="alert">
          {problem}
        </p>
      )}
      {state === 'saved' ? (
        <p className={styles.saved} role="status">
          <CheckIcon aria-hidden="true" /> {t.mentorExceptionApplied}
        </p>
      ) : (
        <button
          type="button"
          className={styles.confirmButton}
          disabled={state === 'saving'}
          onClick={() => void apply()}
        >
          {t.mentorExceptionApply}
        </button>
      )}
    </div>
  );
}

/** «Запомнить?» (ADR 0075): a fact about the learner, kept only if they tap. */
function MemoryChip({ fact }: { fact: Extract<MentorCard, { type: 'memory' }> }) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'no'>('idle');
  if (state === 'no') return null;
  return (
    <div className={styles.memory}>
      <p className={styles.memoryText}>
        <SparkleIcon aria-hidden="true" /> {fact.text}
      </p>
      {state === 'saved' ? (
        <p className={styles.saved} role="status">
          <CheckIcon aria-hidden="true" /> {t.mentorRemembered}
        </p>
      ) : (
        <div className={styles.memoryActions}>
          <button
            type="button"
            className={styles.confirmButton}
            disabled={state === 'saving'}
            onClick={() => {
              setState('saving');
              api.mentorAddFact(fact.kind, fact.text, 'chat').then(
                () => setState('saved'),
                () => setState('idle'),
              );
            }}
          >
            {t.mentorRememberAsk}
          </button>
          <button type="button" className={styles.memoryNo} onClick={() => setState('no')}>
            {t.mentorRememberNo}
          </button>
        </div>
      )}
    </div>
  );
}
