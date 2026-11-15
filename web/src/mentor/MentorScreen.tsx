import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, describeError } from '../lib/api.ts';
import type { Session } from '../lib/types.ts';
import { study } from '../study/device.ts';
import { BulbIcon, FlameIcon, RepeatIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { t } from '../i18n/index.ts';
import { collectMentorInput } from './inputs.ts';
import { MentorChat } from './MentorChat.tsx';
import { planToday } from './plan.ts';
import { PlanCard } from './PlanCard.tsx';
import { pickTip } from './tip.ts';
import type { MentorInput, PlanItem, Tip } from './types.ts';
import styles from './MentorScreen.module.css';

interface MentorScreenProps {
  /** The signed-in account's id — used to read per-account reading progress from localStorage. */
  account: string;
  /** Open an article of the library or of the learner's own texts. */
  onOpenArticle: (articleId: string) => void;
  /** Start a study session for a deck, reusing the app's `startSession` helper. */
  onStartSession: (session: Session, from: string) => void;
}

/**
 * The Mentor tab: greeting, a canned tip, and 0–3 cards for today's work (vocab, spelling, a
 * reading). Every number shown comes from a real source; when a source is missing, its line is
 * hidden rather than shown as zero.
 */
export function MentorScreen({ account, onOpenArticle, onStartSession }: MentorScreenProps) {
  const [input, setInput] = useState<MentorInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [planRefreshing, setPlanRefreshing] = useState(false);
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

  // Re-fetch the plan when the page becomes visible again (e.g. after a study session).
  useEffect(() => {
    function onVisible() {
      if (!document.hidden) void load();
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

  const items = planToday(input);
  const tip = pickTip(input);

  const startItem = async (item: PlanItem) => {
    if (busy) return;
    if (item.kind === 'reading') {
      onOpenArticle(item.articleId);
      return;
    }
    setBusy(true);
    try {
      const session =
        item.kind === 'vocab'
          ? await study.startStudySession(item.deckId)
          : await study.startSpellingSession(item.deckId);
      onStartSession(session, item.deckId);
    } catch (caught) {
      // Nothing to study is a normal state — reload so the plan updates instead of showing an error.
      if (caught instanceof ApiError && caught.status === 409) load();
      else setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles.screen}>
      <div className={styles.topbar}>
        {input.streakWeeks !== null && input.streakWeeks > 0 && (
          <p className={styles.streak}>
            <FlameIcon aria-hidden="true" />
            {t.weeksInARow(input.streakWeeks)}
          </p>
        )}
      </div>
      <div className={styles.main}>
        <div className={styles.column}>
          <section className={styles.head}>
            <h1 ref={headingRef} className={styles.title} tabIndex={-1}>
              {greetingFor(input.phase, input.name)}
            </h1>
          </section>

          <section className={styles.tipCard} aria-labelledby="mentor-tip-heading">
            <span className={styles.tipHead} id="mentor-tip-heading">
              <BulbIcon aria-hidden="true" />
              {t.mentorTipHeading}
            </span>
            <p className={styles.tipBody}>{tipText(tip)}</p>
          </section>

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
            {items.length === 0 ? (
              <p className={styles.empty}>{t.mentorPlanEmpty}</p>
            ) : (
              <ul className={styles.list}>
                {items.map((item) => (
                  <PlanCard key={keyOf(item)} item={item} busy={busy} onStart={() => void startItem(item)} />
                ))}
              </ul>
            )}
          </section>

          <MentorChat items={items} />
        </div>
      </div>
    </main>
  );
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

function keyOf(item: PlanItem): string {
  if (item.kind === 'reading') return `reading:${item.articleId}`;
  return `${item.kind}:${item.deckId}`;
}
