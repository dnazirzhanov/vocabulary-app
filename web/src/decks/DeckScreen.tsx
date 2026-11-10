import { withSnapshot } from '../local/session.ts';
import { study } from '../study/device.ts';
import type { DayPlan } from '../study/plan.ts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { rich } from '../i18n/rich.tsx';
import { api, describeError } from '../lib/api.ts';
import { wordsLabel } from '../lib/pace.ts';
import { deckStages } from '../lib/deckStages.ts';
import { studyLabel } from '../lib/today.ts';
import type { DeckStats, Pace, Session } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { SuggestionCard } from '../home/SuggestionCard.tsx';
import { PausedSpelling } from '../spelling/PausedSpelling.tsx';
import { SpellingModes } from '../spelling/SpellingModes.tsx';
import { DailyPace, ExtraWords } from './DeckPace.tsx';
import { GiveButton } from './GiveButton.tsx';
import { GiveDialog } from './GiveDialog.tsx';
import { BackIcon, ForwardIcon, PencilIcon, PlusIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './DeckScreen.module.css';
import { t } from '../i18n/index.ts';

type Loaded = {
  stats: DeckStats;
  active: Session | null;
  pace: Pace | null;
  /** Today in the deck as this device plans it (with or without a connection). */
  today: DayPlan | null;
  /** I own a group, so I can give this deck to it; `given`: the groups that have it (ADR 0036). */
  canGive: boolean;
  given: { name: string }[];
};

interface DeckScreenProps {
  deckId: string;
  backLabel: string;
  onBack: () => void;
  /** A session started or resumed from here; `deckId` is the deck it belongs to. */
  onSession: (session: Session, deckId: string) => void;
  /** Its words; `mine`: my own deck, which is edited from there (ADR 0051). */
  onWords: (deckId: string, title: string, mine: boolean) => void;
  /** My own deck: straight to adding words (its editor). */
  onAddWords: (deckId: string) => void;
}

/**
 * A deck's page (ADR 0020): where I am with it — words met and remembered well, today's cards in
 * Anki's three numbers, its own new words a day (ADR 0028) — and one button that studies this
 * deck, within today's pace. More words today are one tap further.
 */
export function DeckScreen({ deckId, backLabel, onBack, onSession, onWords, onAddWords }: DeckScreenProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modesOpen, setModesOpen] = useState(false);
  // Renaming my own deck, in place (ADR 0035).
  const [renaming, setRenaming] = useState(false);
  const [giving, setGiving] = useState(false);
  const [name, setName] = useState('');
  const [extraOpen, setExtraOpen] = useState(false);
  const { run, busy, error } = useAsyncAction();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(
    () =>
      // Worked out on this device from what it keeps, with or without a connection (ADR 0062); a
      // deck it can't hold yet comes from the server, or as last seen.
      Promise.all([
        study
          .deckStats(deckId)
          .catch(() => withSnapshot(`deckStats:${deckId}`, () => api.deckStats(deckId)).then(({ value }) => value)),
        study.activeSession(),
      ])
        .then(async ([stats, active]) => {
          // The pace (its suggestion, the setting) is secondary: the page works without it. Today's
          // part is the device's, as its next lesson will be planned.
          const [server, today] = await Promise.all([
            api.pace(deckId).catch(() => null),
            study.dayPlan(deckId).catch(() => null),
          ]);
          const pace =
            server && today
              ? {
                  ...server,
                  blocked_by_reviews: today.blockedByReviews,
                  bonus: today.bonus,
                  next_lesson_size: today.nextLessonSize,
                }
              : server;
          // Giving a deck to a group is for a group's owner (ADR 0036): one I wrote, or a course
          // level to study with friends (ADR 0065).
          const canGive =
            stats.is_mine || stats.kind === 'course'
              ? await api.groups().then(
                  (groups) => groups.some((group) => group.can.includes('give_decks')),
                  () => false,
                )
              : false;
          const given = canGive
            ? await api.teacherDeck(deckId).then(
                (deck) => deck.groups,
                () => [],
              )
            : [];
          setLoaded({ stats, active: active.session, pace, today, canGive, given });
        })
        .catch((caught: unknown) => setLoadError(describeError(caught))),
    [deckId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const focused = useRef(false);
  useEffect(() => {
    if (!loaded || focused.current) return;
    focused.current = true;
    headingRef.current?.focus();
  }, [loaded]);

  if (loadError) {
    return (
      <main className="message-screen">
        <p role="alert">{loadError}</p>
        <PrimaryButton type="button" onClick={() => (setLoadError(null), void load())}>
          {t.tryAgain}
        </PrimaryButton>
      </main>
    );
  }
  if (!loaded) {
    return (
      <main className="message-screen" aria-busy="true">
        <p>{t.loading}</p>
      </main>
    );
  }

  const { stats, active, pace, today, canGive, given } = loaded;
  const due = stats.learning_count + stats.review_count;
  // An unfinished lesson in this deck is resumed here; one in another deck is set aside when this
  // one starts (ADR 0035). An unfinished spelling waits beside it, on its own card (ADR 0026).
  const resumeHere = active !== null && active.deck_id === deckId;
  const blocked = (today?.blockedByReviews ?? pace?.blocked_by_reviews ?? false) && due > 0;
  const left = stats.word_count - stats.introduced_count;
  // Today's pace done but words left: a bonus lesson is still there to take (ADR 0010).
  const bonus =
    stats.new_today === 0 && left > 0 && !stats.locked && !blocked && (today?.bonus ?? pace?.bonus ?? false);
  const fresh = bonus ? Math.min(today?.nextLessonSize ?? pace?.next_lesson_size ?? 0, left) : stats.new_today;
  const label = resumeHere ? t.continueLesson : studyLabel({ due, fresh, started: stats.introduced_count > 0, bonus });
  // Where the deck comes from: nothing to say for my own; for the others, who gave it or the level.
  const source = stats.is_mine
    ? null
    : stats.author
      ? t.from(stats.author, stats.group_name ?? '')
      : (stats.group_name ?? stats.level);
  // Spelling (ADR 0026): the main button takes due hard words and words never spelled; the other
  // sets are one tap further, under «Другие режимы».
  const spelling = stats.spelling_today;
  const mainSpelling = spelling.ready > 0 || spelling.paused !== null;
  const unwritten = Math.max(0, spelling.ready - spelling.due);
  const spellingNote =
    spelling.due > 0 && unwritten > 0
      ? t.toReviewAndNew(spelling.due, unwritten)
      : spelling.due > 0
        ? t.toReview(wordsLabel(spelling.due))
        : t.wordsYouHavenTWrittenYet;
  // Extra words today: there are words left to meet, and nothing else comes first.
  const canAddWords = left > 0 && !stats.locked && !blocked && !resumeHere && pace !== null;
  const startWith = async (extra: number) => {
    await study.addExtraWords(deckId, extra);
    onSession(await study.startStudySession(deckId), deckId);
  };
  const stages = deckStages({
    word_count: stats.word_count,
    met: stats.introduced_count,
    learned: stats.learned,
  });
  const share = (part: number) => `${stats.word_count ? (part / stats.word_count) * 100 : 0}%`;

  return (
    <div className={styles.screen}>
      <header className={styles.topbar}>
        <button type="button" className={styles.back} onClick={onBack}>
          <BackIcon aria-hidden="true" /> {backLabel}
        </button>
      </header>
      <main className={styles.main}>
        <div className={styles.column}>
          <div className={styles.head}>
            {source && <p className={styles.eyebrow}>{source}</p>}
            {renaming ? (
              <form
                className={styles.rename}
                onSubmit={(event) => {
                  event.preventDefault();
                  const clean = name.trim();
                  if (clean.length < 2 || clean === stats.title) return setRenaming(false);
                  run(async () => {
                    await api.renameDeck(deckId, clean);
                    setRenaming(false);
                    await load();
                  });
                }}
              >
                <label className="visually-hidden" htmlFor="deck-name">
                  {t.deckName}
                </label>
                <input
                  id="deck-name"
                  value={name}
                  maxLength={80}
                  autoFocus
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => event.key === 'Escape' && setRenaming(false)}
                />
                <div className={styles.renameButtons}>
                  <button type="submit" className={styles.renameSave} disabled={busy || name.trim().length < 2}>
                    {t.save}
                  </button>
                  <button type="button" className={styles.renameCancel} onClick={() => setRenaming(false)}>
                    {t.cancel}
                  </button>
                </div>
              </form>
            ) : (
              <div className={styles.titleRow}>
                <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
                  {stats.title}
                </h1>
                {stats.is_mine && (
                  <div className={styles.titleActions}>
                    <button
                      type="button"
                      className={styles.renameButton}
                      onClick={() => (setName(stats.title), setRenaming(true))}
                      aria-label={t.renameDeck}
                      title={t.rename}
                    >
                      <PencilIcon aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            )}
            {/* The same labelled button as on the editor's card (ADR 0036). */}
            {!renaming && canGive && stats.word_count > 0 && (
              <div className={styles.giveRow}>
                <GiveButton groups={given} onClick={() => setGiving(true)} />
              </div>
            )}
          </div>

          <section className={styles.progress} aria-labelledby="deck-progress">
            <h2 id="deck-progress" className="visually-hidden">
              {t.deckProgress}
            </h2>
            {/* The same words as «Прогресс» (ADR 0034): знаю inside учу, the rest впереди. */}
            <p className={styles.figure}>
              {rich(t.startedOfWords(wordsLabel(stats.word_count)), <strong>{stats.introduced_count}</strong>)}
            </p>
            <div
              className={styles.bar}
              role="progressbar"
              aria-label={t.wordsStarted}
              aria-valuetext={stages}
              aria-valuemin={0}
              aria-valuemax={stats.word_count}
              aria-valuenow={stats.introduced_count}
            >
              <span className={styles.barMet} style={{ width: share(stats.introduced_count) }} />
              <span className={styles.barKnown} style={{ width: share(stats.learned) }} />
            </div>
            <p className={styles.legend}>{stages}</p>
          </section>

          {/* What the day holds is on the button below; only the daily number is shown here. */}
          {pace && !stats.locked && left + pace.new_words_today > 0 && (
            <section className={styles.today} aria-label={t.pace}>
              <DailyPace pace={pace} onSaved={() => void study.refresh().then(load, load)} />
            </section>
          )}

          {pace?.suggestion && !resumeHere && (
            <SuggestionCard
              suggestion={pace.suggestion}
              target={pace.target}
              onAccept={async (value) => {
                await api.updateMe({ daily_target_words: value });
                await load();
              }}
              onDismiss={async () => {
                await api.dismissSuggestion(pace.suggestion!.kind);
                await load();
              }}
            />
          )}

          <nav className={styles.links} aria-label={t.moreForThisDeck}>
            {canAddWords && (
              <button
                type="button"
                className={styles.link}
                onClick={() => setExtraOpen(true)}
                aria-label={t.moreWordsToday}
                aria-haspopup="dialog"
                aria-describedby="extra-note"
              >
                <PlusIcon aria-hidden="true" />
                <span>
                  <strong>{t.moreWordsToday}</strong>
                  <small id="extra-note">{t.asManyAsYouLikeJust}</small>
                </span>
                <ForwardIcon className={styles.chevron} aria-hidden="true" />
              </button>
            )}
            {spelling.paused && (
              <div className={styles.paused}>
                <PausedSpelling
                  paused={spelling.paused}
                  disabled={busy}
                  onResume={() => run(async () => onSession(await study.startSpellingSession(deckId), deckId))}
                />
              </div>
            )}
            {spelling.ready > 0 && !spelling.paused && (
              <button
                type="button"
                className={styles.link}
                disabled={busy}
                onClick={() => run(async () => onSession(await study.startSpellingSession(deckId), deckId))}
                aria-label={t.spelling(wordsLabel(spelling.ready))}
                aria-describedby="spelling-note"
              >
                <PencilIcon aria-hidden="true" />
                <span>
                  <strong>{t.spellingWords(wordsLabel(spelling.ready))}</strong>
                  <small id="spelling-note">{spellingNote}</small>
                </span>
                <ForwardIcon className={styles.chevron} aria-hidden="true" />
              </button>
            )}
            {/* A group's test can make words hard before any lesson meets one (ADR 0048). */}
            {(spelling.met > 0 || spelling.hard > 0) && (
              <button
                type="button"
                className={styles.link}
                onClick={() => setModesOpen(true)}
                aria-label={mainSpelling ? t.spellingOtherModes : t.spellingTitle}
                aria-describedby="spelling-modes-note"
                aria-haspopup="dialog"
              >
                {/* Under the main button, its text lines up with that button's. */}
                {spelling.ready === 0 && !spelling.paused && <PencilIcon aria-hidden="true" />}
                {spelling.ready > 0 && !spelling.paused && <span className={styles.iconSpace} />}
                <span>
                  <strong>{mainSpelling ? t.spellingOtherModes : t.spellingTitle}</strong>
                  <small id="spelling-modes-note">
                    {mainSpelling
                      ? t.todaySHardOrShuffled
                      : spelling.hard > 0
                        ? t.hardWordsTodaySHardOr(spelling.hard)
                        : t.allWrittenForTodayTodayS}
                  </small>
                </span>
                <ForwardIcon className={styles.chevron} aria-hidden="true" />
              </button>
            )}
            {stats.is_mine && (
              <button type="button" className={styles.link} onClick={() => onAddWords(deckId)}>
                <PlusIcon aria-hidden="true" />
                <span>
                  <strong>{t.addWords}</strong>
                </span>
                <ForwardIcon className={styles.chevron} aria-hidden="true" />
              </button>
            )}
            <button type="button" className={styles.link} onClick={() => onWords(deckId, stats.title, stats.is_mine)}>
              <span>
                <strong>{t.allTheDeckSWords}</strong>
                <small>{stats.is_mine ? t.withProgressAddAndCorrect : t.withYourProgressOnEach}</small>
              </span>
              <ForwardIcon className={styles.chevron} aria-hidden="true" />
            </button>
          </nav>
          {extraOpen && pace && (
            <ExtraWords open pace={pace} left={left} onClose={() => setExtraOpen(false)} onStart={startWith} />
          )}
          {giving && (
            <GiveDialog
              deckId={deckId}
              onClose={() => setGiving(false)}
              onChanged={(deck) => setLoaded((now) => (now ? { ...now, given: deck.groups } : now))}
            />
          )}
          {modesOpen && (
            <SpellingModes
              open
              state={spelling}
              onClose={() => setModesOpen(false)}
              onStart={async (mode, size) => onSession(await study.startSpellingSession(deckId, mode, size), deckId)}
            />
          )}
        </div>
      </main>
      <footer className={styles.actions}>
        <div className={styles.actionsInner}>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {
            <PrimaryButton
              type="button"
              className={styles.action}
              disabled={busy || stats.locked || !label}
              aria-busy={busy}
              onClick={() =>
                // The goal met, «Ещё N слов» takes them as today's extra words (ADR 0028).
                run(async () =>
                  resumeHere
                    ? onSession(active, deckId)
                    : bonus
                      ? startWith(fresh)
                      : onSession(await study.startStudySession(deckId), deckId),
                )
              }
            >
              {busy ? t.loading : stats.locked ? t.opensAfterThePreviousLevel : (label ?? t.thatSAllForToday)}
            </PrimaryButton>
          }
        </div>
      </footer>
    </div>
  );
}
