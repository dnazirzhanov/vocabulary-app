import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, describeError, type Coach, type MentorPlanItem } from '../lib/api.ts';
import type { Session } from '../lib/types.ts';
import { study } from '../study/device.ts';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { t, uiLanguage } from '../i18n/index.ts';
import { listEvents } from '../schedule/api.ts';
import type { ScheduleEvent } from '../schedule/types.ts';
import { ScheduleView } from '../schedule/ScheduleView.tsx';
import { collectMentorInput } from './inputs.ts';
import { markLaunched, reconcileDone } from './done.ts';
import { GoalSetup } from './GoalSetup.tsx';
import { ChatScreen } from './chat/ChatScreen.tsx';
import type { Activity } from './chat/ToolCards.tsx';
import { planToday, withWeek } from './plan.ts';
import { busyNow, freeUntil, slotsFor } from './slots.ts';
import { pickTip } from './tip.ts';
import { titleOf, TodayView } from './TodayView.tsx';
import type { MentorGoalType, MentorInput, PlanItem, Tip } from './types.ts';
import styles from './MentorScreen.module.css';

interface MentorScreenProps {
  account: string;
  onOpenArticle: (articleId: string) => void;
  onStartSession: (session: Session, from: string) => void;
  onOpenWriting: () => void;
  onOpenSpeaking: () => void;
}

/** The coach's last answer, kept on the device so the home opens without a connection. */
const coachKey = (account: string) => `mentor-coach:${account}`;

function keptCoach(account: string): Coach | null {
  try {
    return JSON.parse(localStorage.getItem(coachKey(account)) ?? 'null') as Coach | null;
  } catch {
    return null;
  }
}

/**
 * The mentor tab (ADR 0071, 0072): «Сегодня» as a to-do list, the chat, the calendar, and the
 * first goal. The plan's tasks are made on the device from its own decks and library; the coach
 * (goal, week, promised time, weekly adjustment) comes from the server and is kept for offline.
 */
export function MentorScreen({
  account,
  onOpenArticle,
  onStartSession,
  onOpenWriting,
  onOpenSpeaking,
}: MentorScreenProps) {
  const [input, setInput] = useState<MentorInput | null>(null);
  const [coach, setCoach] = useState<Coach | null>(() => keptCoach(account));
  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chat, setChat] = useState<{ ask: string | null } | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const keepCoach = useCallback(
    (next: Coach) => {
      setCoach(next);
      try {
        localStorage.setItem(coachKey(account), JSON.stringify(next));
      } catch {
        // storage blocked: kept for this visit only
      }
    },
    [account],
  );

  const load = useCallback(() => {
    // The coach and the schedule need the server; without it, the kept coach and no times.
    void api.coach().then(keepCoach, () => undefined);
    void listEvents().then(setEvents, () => undefined);
    return collectMentorInput(account).then(
      (next) => {
        setNow(new Date());
        setInput(next);
      },
      (caught: unknown) => setError(describeError(caught)),
    );
  }, [account, keepCoach]);

  useEffect(() => {
    void load();
  }, [load]);

  // The times move on: «free until», «now» and slots stay true while the tab is open.
  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(tick);
  }, []);

  const lastRefreshAt = useRef(0);
  // Set when the learner starts a task from here; the next return refreshes at once.
  const taskLaunchedRef = useRef(false);
  useEffect(() => {
    function onVisible() {
      if (document.hidden) return;
      const at = Date.now();
      if (!taskLaunchedRef.current && at - lastRefreshAt.current < 30_000) return;
      lastRefreshAt.current = at;
      taskLaunchedRef.current = false;
      void load();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  if (error) {
    return (
      <main className="message-screen">
        <p role="alert">{error}</p>
        <PrimaryButton
          type="button"
          onClick={() => {
            setError(null);
            void load();
          }}
        >
          {t.tryAgain}
        </PrimaryButton>
      </main>
    );
  }
  if (!input) {
    return (
      <main className="message-screen" aria-busy="true">
        <p>{t.loading}</p>
      </main>
    );
  }

  // The first visit, or «Изменить» on the goal: what for, and how long a day.
  if (!input.goal || editingGoal) {
    return (
      <main className={styles.screen}>
        <GoalSetup
          initialGoal={input.goal}
          initialMinutes={input.dailyMinutes}
          onDone={() => {
            setEditingGoal(false);
            void load();
          }}
        />
      </main>
    );
  }

  const dailyMinutes = coach?.commitment.minutes ?? input.dailyMinutes;
  const items = withWeek(planToday(input), coach?.behind ?? [], dailyMinutes, {
    writing: t.mentorActivityWriting,
    speaking: t.mentorActivitySpeaking,
  });
  const tip = pickTip(input);
  const doneItems = reconcileDone(account, new Set(items.map(keyOf)));

  const minute = now.getHours() * 60 + now.getMinutes();
  const weekday = (now.getDay() + 6) % 7;
  const today = events
    .filter((e) => e.weekdays & (1 << weekday))
    .map((e) => ({ start: e.startMinute, end: e.endMinute, title: e.title }));
  const slots = slotsFor(items, today, minute, coach?.commitment.start_minute ?? null);
  const inBlock = busyNow(today, minute);

  const launch = async (item: PlanItem) => {
    if (busy) return;
    markLaunched(account, item, keyOf(item));
    taskLaunchedRef.current = true;
    if (item.kind === 'reading') return onOpenArticle(item.articleId);
    if (item.kind === 'writing') return onOpenWriting();
    if (item.kind === 'speaking') return onOpenSpeaking();
    setBusy(true);
    try {
      const session =
        item.kind === 'vocab'
          ? await study.startStudySession(item.deckId)
          : await study.startSpellingSession(item.deckId);
      onStartSession(session, item.deckId);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) void load();
      else setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  // «Начать сейчас» on a mentor's card: the same doors as the list's own.
  const startActivity = async (activity: Activity) => {
    const matched = items.find(
      (i) =>
        (i.kind === 'reading' && i.articleId === activity.article_id) ||
        ((i.kind === 'vocab' || i.kind === 'spelling') && i.kind === activity.kind && i.deckId === activity.deck_id) ||
        ((i.kind === 'writing' || i.kind === 'speaking') && i.kind === activity.kind),
    );
    if (matched) return launch(matched);
    taskLaunchedRef.current = true;
    if (activity.kind === 'reading' && activity.article_id) return onOpenArticle(activity.article_id);
    if (activity.kind === 'writing') return onOpenWriting();
    if (activity.kind === 'speaking') return onOpenSpeaking();
    if (!activity.deck_id) return;
    try {
      const session =
        activity.kind === 'spelling'
          ? await study.startSpellingSession(activity.deck_id)
          : await study.startStudySession(activity.deck_id);
      onStartSession(session, activity.deck_id);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) void load();
      else setError(describeError(caught));
    }
  };

  if (scheduleOpen) {
    return (
      <main className={styles.chatScreen}>
        <ScheduleView
          onBack={() => {
            setScheduleOpen(false);
            void load();
          }}
          study={items.map((item, i) => ({
            key: keyOf(item),
            title: titleOf(item),
            minutes: item.minutes,
            at: slots[i],
            onStart: () => void launch(item),
          }))}
          commitment={
            coach
              ? {
                  weekdays: coach.commitment.weekdays,
                  start: coach.commitment.start_minute,
                  minutes: coach.commitment.minutes,
                }
              : null
          }
          onAsk={(question) => {
            setScheduleOpen(false);
            setChat({ ask: question });
          }}
        />
      </main>
    );
  }

  if (chat) {
    return (
      <main className={styles.chatScreen}>
        <ChatScreen
          name={input.name}
          plan={items.map(planPayload)}
          tipId={tip.id}
          ask={chat.ask}
          onBack={() => {
            setChat(null);
            void load();
          }}
          onStart={startActivity}
          onOpenCalendar={() => {
            setChat(null);
            setScheduleOpen(true);
          }}
        />
      </main>
    );
  }

  const goal = coach?.goal;
  const goalLabel = [
    goalName((goal?.kind ?? input.goal) as MentorGoalType),
    goal?.target,
    goal?.deadline
      ? t.mentorGoalBy(
          new Date(`${goal.deadline}T12:00:00`).toLocaleDateString(uiLanguage, { day: 'numeric', month: 'long' }),
        )
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <main className={styles.screen}>
      <div className={styles.main}>
        <TodayView
          greeting={greetingFor(input.phase, input.name)}
          coach={coach}
          goalLabel={goalLabel}
          tasks={items.map((item, i) => ({ item, key: keyOf(item), at: slots[i] }))}
          done={doneItems}
          busy={inBlock ? { title: inBlock.title, end: inBlock.end } : null}
          freeUntil={freeUntil(today, minute)}
          minute={minute}
          tip={tipText(tip)}
          busyStarting={busy}
          onStart={(item) => void launch(item)}
          onAsk={(question) => setChat({ ask: question ?? null })}
          onOpenCalendar={() => setScheduleOpen(true)}
          onEditGoal={() => setEditingGoal(true)}
          onDecide={(accept) => {
            const adjustment = coach?.adjustment;
            if (adjustment) void api.coachDecide(adjustment.id, accept).then(keepCoach, () => undefined);
          }}
        />
      </div>
    </main>
  );
}

/** A task as the chat's tools get it: what it is, and what «Начать сейчас» opens. */
function planPayload(item: PlanItem): MentorPlanItem {
  if (item.kind === 'reading')
    return { kind: 'reading', title: item.title, minutes: item.minutes, level: item.level, articleId: item.articleId };
  if (item.kind === 'writing' || item.kind === 'speaking')
    return { kind: item.kind, title: item.title, minutes: item.minutes };
  return { kind: item.kind, title: item.title, count: item.count, minutes: item.minutes, deckId: item.deckId };
}

function keyOf(item: PlanItem): string {
  if (item.kind === 'reading') return `reading:${item.articleId}`;
  if (item.kind === 'writing' || item.kind === 'speaking') return `${item.kind}:today`;
  return `${item.kind}:${item.deckId}`;
}

function goalName(type: MentorGoalType): string {
  switch (type) {
    case 'ielts':
      return t.mentorGoalTypeIelts;
    case 'conversation':
      return t.mentorGoalTypeConversation;
    case 'travel':
      return t.mentorGoalTypeTravel;
    case 'business':
      return t.mentorGoalTypeBusiness;
    case 'academic':
      return t.mentorGoalTypeAcademic;
    case 'general':
      return t.mentorGoalTypeGeneral;
  }
}

function greetingFor(phase: MentorInput['phase'], name: string | null): string {
  const base = {
    morning: t.mentorGreetingMorning,
    afternoon: t.mentorGreetingAfternoon,
    evening: t.mentorGreetingEvening,
    night: t.mentorGreetingNight,
  }[phase];
  return name && name.length > 0 ? `${base}, ${name}` : base;
}

function tipText(tip: Tip): string {
  switch (tip.id) {
    case 'firstRun':
      return t.mentorTipFirstRun;
    case 'newLearner':
      return t.mentorTipNewLearner;
    case 'returner':
      return t.mentorTipReturner;
    case 'streakMilestone':
      return t.mentorTipStreakMilestone(tip.weeks ?? 0);
    case 'streakKeep':
      return t.mentorTipStreakKeep(tip.weeks ?? 0);
    case 'bigBacklog':
      return t.mentorTipBigBacklog(tip.total ?? 0);
    case 'dueInDeck':
      return t.mentorTipDueInDeck(tip.count ?? 0, tip.deckTitle ?? '');
    case 'spellingAwaits':
      return t.mentorTipSpellingAwaits(tip.count ?? 0);
    case 'allCaughtUp':
      return t.mentorTipAllCaughtUp;
    case 'readingFresh':
      return t.mentorTipReadingFresh;
    case 'default':
      return t.mentorTipDefault;
  }
}
