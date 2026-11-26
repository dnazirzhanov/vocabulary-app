import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SpellingExercise } from '../lesson/SpellingExercise.tsx';
import { LessonProgress } from '../lesson/LessonProgress.tsx';
import lesson from '../lesson/LessonScreen.module.css';
import { api, ApiError, describeError } from '../lib/api.ts';
import { clockText, rememberRunningTest } from '../lib/groupTests.ts';
import type { TestAttempt, TestWordState } from '../lib/types.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { CloseIcon, MusicIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import shared from '../groups/Groups.module.css';
import { SaveQueue, StopSaving } from './saveQueue.ts';
import { TestCheck } from './TestCheck.tsx';
import { TestResult } from './TestResult.tsx';
import { useSecondsLeft } from './useSecondsLeft.ts';
import { useTestMusic } from './useTestMusic.ts';
import styles from './Tests.module.css';
import { t } from '../i18n/index.ts';

// The server may still be a moment short of the deadline when the device reaches it.
const ASK_AGAIN_MS = 1000;

interface TestRunProps {
  groupId: string;
  deckId: string;
  attemptId: string;
  /** The attempt just started; absent after a reload, when it comes from the server. */
  initial?: TestAttempt;
  onDone: () => void;
}

/**
 * Taking a test or a practice (ADR 0046, 0069): the lesson's screen and spelling card, one word at a
 * time in the order the server keeps, with nothing said about each until the end. Every word's card
 * arrives with the attempt, so «Назад», «Дальше» and «Пропустить» move at once, on the device, and
 * answers save behind them in order (`SaveQueue`); the tiles never wait for the network. After the
 * last word a check shows every word's state, and «Сдать» hands in once everything is saved. At zero
 * the tiles lock, a word fully built is saved, and the server hands in what it has.
 */
export function TestRun({ groupId, deckId, attemptId, initial, onDone }: TestRunProps) {
  const [attempt, setAttempt] = useState<TestAttempt | null>(initial ?? null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trouble, setTrouble] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [position, setPosition] = useState(initial?.position ?? 0);
  // After the last word: every word's state, and the way to hand in.
  const [checking, setChecking] = useState(false);
  // «К пропущенным»: the words without an answer, gone through in turn; null when going in order.
  const [review, setReview] = useState<number[] | null>(null);
  // What this device has given each word (key → answer; null: skipped), ahead of the server.
  const [given, setGiven] = useState<Map<string, string | null>>(() => new Map());
  const draft = useRef<string | null>(null);
  const askedAtZero = useRef(false);

  // The attempt being taken: the one opened, or a new practice started from its result.
  const liveId = attempt?.id ?? attemptId;
  const queue = useMemo(
    () =>
      new SaveQueue(async ({ key, answer }) => {
        try {
          const saved = await api.saveTestAnswer(liveId, key, answer, 0);
          // Only a finished attempt changes the screen; a running one is already ahead here.
          if (saved.result) setAttempt(saved);
        } catch (caught) {
          // Erased by a change of the test's words, or the deck was taken back.
          if (caught instanceof ApiError && caught.status === 404) {
            setGone(true);
            throw new StopSaving();
          }
          throw caught;
        }
      }, setTrouble),
    [liveId],
  );

  /** Saves what is waiting, then asks the server: handing in, or the time being up. */
  const finish = useCallback(
    async (action: () => Promise<TestAttempt>) => {
      setBusy(true);
      setError(null);
      try {
        await queue.idle();
        setAttempt(await action());
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 404) setGone(true);
        else setError(describeError(caught));
      } finally {
        setBusy(false);
      }
    },
    [queue],
  );

  // Not through `finish`: nothing is on screen yet to mark as busy.
  const load = useCallback(
    () =>
      api.testAttempt(attemptId).then(
        (got) => {
          setAttempt(got);
          setPosition(got.position ?? 0);
        },
        (caught: unknown) => {
          if (caught instanceof ApiError && caught.status === 404) setGone(true);
          else setError(describeError(caught));
        },
      ),
    [attemptId],
  );
  const hasInitial = initial !== undefined;
  useEffect(() => {
    if (!hasInitial) void load();
  }, [hasInitial, load]);

  const currentId = attempt?.id;
  useEffect(() => {
    if (currentId) rememberRunningTest({ groupId, deckId, attemptId: currentId });
  }, [groupId, deckId, currentId]);

  // Every word as this device knows it: the server's, with what was given here on top.
  const words: TestWordState[] = useMemo(
    () =>
      (attempt?.words ?? []).map((word) =>
        given.has(word.exercise.id)
          ? {
              ...word,
              answer: given.get(word.exercise.id) ?? null,
              state: given.get(word.exercise.id) === null ? 'skipped' : 'answered',
            }
          : word,
      ),
    [attempt, given],
  );
  const current = words[position] ?? null;

  const left = useSecondsLeft(attempt?.deadline_at ?? null);
  const timeUp = left === 0;
  const running = !!attempt && !attempt.result;
  useEffect(() => {
    if (!timeUp || !attempt || attempt.result || busy || error) return;
    const timer = setTimeout(
      () => {
        const last = draft.current;
        draft.current = null;
        if (last && current && last !== current.answer) queue.push({ key: current.exercise.id, answer: last });
        askedAtZero.current = true;
        // Past the deadline the server hands in whatever it has.
        void finish(() => api.testAttempt(attempt.id));
      },
      askedAtZero.current ? ASK_AGAIN_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [timeUp, attempt, current, busy, error, finish, queue]);

  // Quiz-show music while the words are being answered; faster in a test's last minute.
  const [musicOn, toggleMusic] = useTestMusic(
    running && !gone && !timeUp,
    attempt?.kind === 'test' && left !== null && left <= 60,
  );

  const mainRef = useRef<HTMLElement>(null);
  const setDraft = useCallback((answer: string | null) => {
    draft.current = answer;
    // A long word on a small phone pushes «Дальше» out of sight, and scrolling costs test time.
    if (answer !== null) mainRef.current?.scrollTo({ top: mainRef.current.scrollHeight });
  }, []);

  if (gone) {
    return (
      <main className="message-screen">
        <p role="alert">{t.theTestHasChangedStartAgain}</p>
        <PrimaryButton type="button" onClick={onDone}>
          {t.back}
        </PrimaryButton>
      </main>
    );
  }
  if (!attempt) {
    return (
      <main className="message-screen" aria-busy={!error}>
        {error ? <p role="alert">{error}</p> : <p>{t.loading}</p>}
        {error && (
          <PrimaryButton type="button" onClick={() => (setError(null), void load())}>
            {t.tryAgain}
          </PrimaryButton>
        )}
      </main>
    );
  }
  if (attempt.result) {
    return (
      <TestResult
        attempt={attempt}
        result={attempt.result}
        busy={busy}
        error={error}
        onAgain={() => {
          // A new practice: a new attempt, so a new screen (and a new queue) from its first word.
          setBusy(true);
          api.startTestAttempt(groupId, deckId, 'practice').then(
            (next) => {
              setBusy(false);
              setAttempt(next);
              setGiven(new Map());
              setPosition(next.position ?? 0);
              setChecking(false);
            },
            (caught: unknown) => {
              setBusy(false);
              setError(describeError(caught));
            },
          );
        }}
        onDone={onDone}
      />
    );
  }

  const last = attempt.total - 1;
  /** Keeps an answer for this word (saved behind the screen) and shows another; past the last, the check. */
  const move = (answer: string | null | undefined, to: number) => {
    if (!current) return;
    const key = current.exercise.id;
    // A skip is saved even on a word never answered, so the check can tell it from one not reached.
    const changed = answer === null ? current.state !== 'skipped' : answer !== undefined && answer !== current.answer;
    if (changed) {
      setGiven((was) => new Map(was).set(key, answer ?? null));
      queue.push({ key, answer: answer ?? null });
    }
    draft.current = null;
    if (to > last) {
      setChecking(true);
      setReview(null);
    } else setPosition(Math.max(0, to));
  };
  // Where «Дальше» and «Назад» go: the next word, or, going through the skipped, the next of those
  // (past the last of them, the check).
  const inReview = review ? review.indexOf(position) : -1;
  const step = (by: 1 | -1) => {
    if (!review || inReview === -1) return position + by;
    const to = review[inReview + by];
    return to === undefined ? (by > 0 ? last + 1 : position) : to;
  };
  // Going back keeps a word fully built; one half-built stays on the device as it was.
  const back = () => move(draft.current ?? undefined, step(-1));
  const timed = attempt.kind === 'test';
  // The bar fills with words that have an answer, right or wrong alike (a test never says which
  // before it is handed in); a skipped word has none, so it doesn't count until it gets one.
  const answered = words.filter((word) => word.state === 'answered').length;

  return (
    <div className={lesson.screen}>
      <header className={lesson.topbar}>
        <div className={lesson.topbarInner}>
          <button
            type="button"
            className={lesson.exit}
            aria-label={timed ? t.exitTheTest : t.exitPractice}
            onClick={() => (timed ? setLeaving(true) : onDone())}
          >
            <CloseIcon />
          </button>
          <LessonProgress answered={answered} total={attempt.total} />
          {left !== null && (
            <p className={styles.clock} role="timer" data-low={left <= 60 || undefined}>
              {clockText(left)}
            </p>
          )}
          <button
            type="button"
            className={styles.music}
            aria-label={t.testMusic}
            aria-pressed={musicOn}
            onClick={toggleMusic}
          >
            <MusicIcon off={!musicOn} />
          </button>
        </div>
      </header>
      <main ref={mainRef} className={lesson.main}>
        {checking ? (
          <TestCheck
            words={words}
            busy={busy || timeUp}
            onOpen={(index) => {
              setChecking(false);
              setReview(null);
              setPosition(index);
            }}
            onReview={() => {
              const missing = words.flatMap((word, index) => (word.state === 'answered' ? [] : [index]));
              if (missing.length === 0) return;
              setReview(missing);
              setChecking(false);
              setPosition(missing[0]);
            }}
            onBack={() => setChecking(false)}
            onHandIn={() => void finish(() => api.submitTest(attempt.id))}
          />
        ) : (
          current && (
            <div key={current.exercise.id} className={lesson.cardWrap}>
              <SpellingExercise
                exercise={current.exercise}
                storageKey={`test:${attempt.id}:${current.exercise.id}`}
                savedAnswer={current.answer}
                busy={timeUp}
                result={null}
                eyebrow={`${timed ? t.test : t.practice} · ${
                  review && inReview !== -1
                    ? t.testSkippedOf(inReview + 1, review.length)
                    : t.testWordOf(position + 1, attempt.total)
                }`}
                submitLabel={
                  (review && inReview !== -1 ? inReview === review.length - 1 : position === last)
                    ? t.testToCheck
                    : t.next
                }
                onDraft={setDraft}
                onSubmit={(answer) => move(answer, step(1))}
                onSkip={() => move(null, step(1))}
                onBack={(review && inReview !== -1 ? inReview > 0 : position > 0) ? back : null}
                onContinue={() => undefined}
              />
            </div>
          )
        )}
        {trouble && !error && (
          <p className={styles.saving} role="status">
            {t.testSavingRetry}
          </p>
        )}
        {error && (
          <div className={styles.runError}>
            <p className={shared.problem} role="alert">
              {error}
            </p>
            {timeUp && (
              <button type="button" className={shared.smallButton} onClick={() => setError(null)}>
                {t.tryAgain}
              </button>
            )}
          </div>
        )}
      </main>
      <Dialog open={leaving} onClose={() => setLeaving(false)} title={t.exitTestQuestion}>
        <div className={styles.setup}>
          <p>{t.theTimeKeepsRunning}</p>
          <button type="button" className={shared.smallButton} data-autofocus onClick={() => setLeaving(false)}>
            {t.continueTheTest}
          </button>
          <button type="button" className={shared.linkButton} onClick={onDone}>
            {t.signOut}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
