import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, describeError, type MentorPlanItem } from '../lib/api.ts';
import type { Session } from '../lib/types.ts';
import { study } from '../study/device.ts';
import { BulbIcon, CardsIcon, FlameIcon, RepeatIcon, SparkleIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { t } from '../i18n/index.ts';
import { collectMentorInput } from './inputs.ts';
import { markLaunched, reconcileDone } from './done.ts';
import { GoalSetup } from './GoalSetup.tsx';
import { ChatScreen } from './chat/ChatScreen.tsx';
import type { Activity } from './chat/ToolCards.tsx';
import { planToday } from './plan.ts';
import { PlanCard } from './PlanCard.tsx';
import { pickTip } from './tip.ts';
import type { MentorInput, MentorGoalType, PlanItem, Tip } from './types.ts';
import { ScheduleView } from '../schedule/ScheduleView.tsx';
import styles from './MentorScreen.module.css';

interface MentorScreenProps {
  account: string;
  onOpenArticle: (articleId: string) => void;
  onStartSession: (session: Session, from: string) => void;
  onOpenWriting: () => void;
  onOpenSpeaking: () => void;
}

export function MentorScreen({
  account,
  onOpenArticle,
  onStartSession,
  onOpenWriting,
  onOpenSpeaking,
}: MentorScreenProps) {
  const [input, setInput] = useState<MentorInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [planRefreshing, setPlanRefreshing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(
    () =>
      collectMentorInput(account).then(
        (next) => setInput(next),
        (caught: unknown) => setError(describeError(caught)),
      ),
    [account],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const lastRefreshAt = useRef(0);
  // Set to true when the user launches a task from here; clears after the next refresh.
  const taskLaunchedRef = useRef(false);
  useEffect(() => {
    function onVisible() {
      if (document.hidden) return;
      const now = Date.now();
      // Always refresh immediately after a task was launched; otherwise respect the 30 s debounce.
      if (!taskLaunchedRef.current && now - lastRefreshAt.current < 30_000) return;
      lastRefreshAt.current = now;
      taskLaunchedRef.current = false;
      void load();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const retry = () => {
    setError(null);
    void load();
  };

  const focused = useRef(false);
  useEffect(() => {
    if (!input || focused.current) return;
    focused.current = true;
    headingRef.current?.focus();
  }, [input]);

  if (error) {
    return (
      <main className="message-screen">
        <p role="alert">{error}</p>
        <PrimaryButton type="button" onClick={retry}>
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

  // Show goal onboarding if no goal set, or if the user clicked "Change goal"
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

  const items = planToday(input);
  const tip = pickTip(input);

  // Reconcile the done store against the fresh plan: anything that was launched earlier today
  // but is no longer in `items` has been completed, so show it muted + checkmark below.
  const activeKeys = new Set(items.map(keyOf));
  const doneItems = reconcileDone(account, activeKeys);

  const startItem = async (item: PlanItem) => {
    if (busy) return;
    if (item.kind === 'reading') {
      markLaunched(account, item, keyOf(item));
      taskLaunchedRef.current = true;
      onOpenArticle(item.articleId);
      return;
    }
    setBusy(true);
    try {
      const session =
        item.kind === 'vocab'
          ? await study.startStudySession(item.deckId)
          : await study.startSpellingSession(item.deckId);
      markLaunched(account, item, keyOf(item));
      taskLaunchedRef.current = true;
      onStartSession(session, item.deckId);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) load();
      else setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  // Schedule view — full-height weekly calendar
  if (scheduleOpen) {
    return (
      <main className={styles.chatScreen}>
        <ScheduleView onBack={() => setScheduleOpen(false)} />
      </main>
    );
  }

  // «Начать сейчас» from a mentor's card: the same doors the plan's own buttons open.
  const startActivity = async (activity: Activity) => {
    const matched = items.find(
      (i) =>
        (i.kind === 'reading' && i.articleId === activity.article_id) ||
        (i.kind !== 'reading' && i.kind === activity.kind && i.deckId === activity.deck_id),
    );
    if (matched) markLaunched(account, matched, keyOf(matched));
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

  // Chat view — full-height, T3 style (ADR 0072)
  if (chatOpen) {
    return (
      <main className={styles.chatScreen}>
        <ChatScreen
          name={input.name}
          plan={items.map(planPayload)}
          tipId={tip.id}
          onBack={() => setChatOpen(false)}
          onStart={startActivity}
          onOpenCalendar={() => {
            setChatOpen(false);
            setScheduleOpen(true);
          }}
        />
      </main>
    );
  }

  // Dashboard view
  const totalDue = input.decks.reduce((s, d) => s + d.dueCount, 0);

  return (
    <main className={styles.screen}>
      <div className={styles.main}>
        <div className={styles.column}>
          {/* Greeting */}
          <section className={styles.head}>
            <h1 ref={headingRef} className={styles.subtitle} tabIndex={-1}>
              {greetingFor(input.phase, input.name)}
            </h1>
            <p className={styles.title}>{t.mentorReadyHeading}</p>
          </section>

          {/* Stats strip */}
          <div className={styles.stats}>
            {input.streakWeeks !== null && input.streakWeeks > 0 && (
              <div className={styles.statPill}>
                <FlameIcon aria-hidden="true" />
                <span className={styles.statNum}>{input.streakWeeks}</span>
                <span className={styles.statLabel}>{t.mentorStatStreak}</span>
              </div>
            )}
            {items.length > 0 && (
              <div className={styles.statPill}>
                <CardsIcon aria-hidden="true" />
                <span className={styles.statNum}>{items.length}</span>
                <span className={styles.statLabel}>{t.mentorStatTasks}</span>
              </div>
            )}
            {totalDue > 0 && (
              <div className={styles.statPill}>
                <SparkleIcon aria-hidden="true" />
                <span className={styles.statNum}>{totalDue}</span>
                <span className={styles.statLabel}>{t.mentorStatDue}</span>
              </div>
            )}
          </div>

          {/* Goal chip */}
          <div className={styles.goalChip}>
            <span className={styles.goalChipText}>
              {t.mentorGoalChip(goalLabel(input.goal as MentorGoalType), input.dailyMinutes ?? 20)}
            </span>
            <button type="button" className={styles.goalEditBtn} onClick={() => setEditingGoal(true)}>
              {t.mentorGoalEditLabel}
            </button>
          </div>

          {/* Tip card */}
          <section className={styles.tipCard} aria-labelledby="mentor-tip-heading">
            <span className={styles.tipHead} id="mentor-tip-heading">
              <BulbIcon aria-hidden="true" />
              {t.mentorTipHeading}
            </span>
            <p className={styles.tipBody}>{tipText(tip)}</p>
          </section>

          {/* Today's plan */}
          <section className={styles.plan} aria-labelledby="mentor-plan-heading">
            <div className={styles.planHeadRow}>
              <h2 className={styles.planHead} id="mentor-plan-heading">
                {t.mentorPlanHeading}
              </h2>
              <button
                type="button"
                className={`${styles.refreshBtn}${planRefreshing ? ` ${styles.refreshing}` : ''}`}
                aria-label={t.mentorPlanRefresh}
                disabled={planRefreshing || busy}
                onClick={() => {
                  setPlanRefreshing(true);
                  void load().finally(() => setPlanRefreshing(false));
                }}
              >
                <RepeatIcon aria-hidden="true" />
              </button>
            </div>
            {items.length === 0 && doneItems.length === 0 ? (
              <p className={styles.empty}>{t.mentorPlanEmpty}</p>
            ) : (
              <ul className={styles.list}>
                {items.map((item) => (
                  <PlanCard key={keyOf(item)} item={item} busy={busy} onStart={() => void startItem(item)} />
                ))}
                {doneItems.map((item) => (
                  <PlanCard key={`done:${keyOf(item)}`} item={item} busy={busy} onStart={() => undefined} done />
                ))}
              </ul>
            )}
          </section>

          {/* Schedule + Open chat buttons */}
          <button type="button" className={styles.scheduleOpenBtn} onClick={() => setScheduleOpen(true)}>
            {t.scheduleOpenBtn}
          </button>
          <button type="button" className={styles.chatOpenBtn} onClick={() => setChatOpen(true)}>
            {t.mentorChatOpen}
          </button>
        </div>
      </div>
    </main>
  );
}

function goalLabel(type: MentorGoalType): string {
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
  const base = (() => {
    switch (phase) {
      case 'morning':
        return t.mentorGreetingMorning;
      case 'afternoon':
        return t.mentorGreetingAfternoon;
      case 'evening':
        return t.mentorGreetingEvening;
      case 'night':
        return t.mentorGreetingNight;
    }
  })();
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

/** A task as the chat's tools get it: what it is, and what «Начать сейчас» opens. */
function planPayload(item: PlanItem): MentorPlanItem {
  return item.kind === 'reading'
    ? { kind: 'reading', title: item.title, minutes: item.minutes, level: item.level, articleId: item.articleId }
    : { kind: item.kind, title: item.title, count: item.count, minutes: item.minutes, deckId: item.deckId };
}

function keyOf(item: PlanItem): string {
  if (item.kind === 'reading') return `reading:${item.articleId}`;
  return `${item.kind}:${item.deckId}`;
}
