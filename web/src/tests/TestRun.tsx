import { useCallback, useEffect, useRef, useState } from 'react';
import { SpellingExercise } from '../lesson/SpellingExercise.tsx';
import { LessonProgress } from '../lesson/LessonProgress.tsx';
import lesson from '../lesson/LessonScreen.module.css';
import { api, ApiError, describeError } from '../lib/api.ts';
import { clockText, rememberRunningTest } from '../lib/groupTests.ts';
import type { TestAttempt } from '../lib/types.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { CloseIcon, MusicIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import shared from '../groups/Groups.module.css';
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
 * Taking a test or a practice (ADR 0046, 0068): the lesson's screen and spelling card, one word at a
 * time in the order the server keeps, with nothing said about each until the end. «Назад» and
 * «Дальше» walk through the words, saving each answer, which stays changeable; «Пропустить» leaves a
 * word empty. After the last word a check shows every word's state, and «Сдать» hands it in. At zero
 * the tiles lock, a word fully built is saved, and the server hands in what it has.
 */
export function TestRun({ groupId, deckId, attemptId, initial, onDone }: TestRunProps) {
  const [attempt, setAttempt] = useState<TestAttempt | null>(initial ?? null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  // After the last word: every word's state, and the way to hand in.
  const [checking, setChecking] = useState(false);
  const draft = useRef<string | null>(null);
  const askedAtZero = useRef(false);

  const call = useCallback(async (action: () => Promise<TestAttempt>, then?: (got: TestAttempt) => void) => {
    setBusy(true);
    setError(null);
    try {
      const got = await action();
      setAttempt(got);
      then?.(got);
    } catch (caught) {
      // Erased by a change of the test's words, or the deck was taken back.
      if (caught instanceof ApiError && caught.status === 404) setGone(true);
      else setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  // Not through `call`: nothing is on screen yet to mark as busy.
  const load = useCallback(
    () =>
      api.testAttempt(attemptId).then(setAttempt, (caught: unknown) => {
        if (caught instanceof ApiError && caught.status === 404) setGone(true);
        else setError(describeError(caught));
      }),
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

  const left = useSecondsLeft(attempt?.deadline_at ?? null);
  const timeUp = left === 0;
  const question = attempt?.question ?? null;
  const position = attempt?.position ?? 0;
  useEffect(() => {
    if (!timeUp || !attempt || attempt.result || !question || busy || error) return;
    const timer = setTimeout(
      () => {
        const last = draft.current;
        draft.current = null;
        askedAtZero.current = true;
        // Past the deadline the server hands in whatever it has, this last word included.
        void call(() =>
          last && last !== attempt.answer
            ? api.saveTestAnswer(attempt.id, question.id, last, position)
            : api.testAttempt(attempt.id, position),
        );
      },
      askedAtZero.current ? ASK_AGAIN_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [timeUp, attempt, question, position, busy, error, call]);

  // Quiz-show music while the words are being answered; faster in a test's last minute.
  const answering = !!attempt && !attempt.result && !!question && !gone && !timeUp;
  const [musicOn, toggleMusic] = useTestMusic(answering, attempt?.kind === 'test' && left !== null && left <= 60);

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
        onAgain={() =>
          void call(
            () => api.startTestAttempt(groupId, deckId, 'practice'),
            () => setChecking(false),
          )
        }
        onDone={onDone}
      />
    );
  }

  const last = attempt.total - 1;
  /** Saves this word (or leaves it as saved) and shows another; past the last one, the check. */
  const move = (answer: string | null | undefined, to: number) => {
    if (!question) return;
    const review = to > last;
    const at = Math.min(Math.max(to, 0), last);
    // A skip is saved even on a word never answered, so the check can tell it from one not reached.
    const skipping = answer === null && attempt.words[position]?.state !== 'skipped';
    const changed = skipping || (answer !== undefined && answer !== attempt.answer);
    void call(
      () => (changed ? api.saveTestAnswer(attempt.id, question.id, answer, at) : api.testAttempt(attempt.id, at)),
      () => setChecking(review),
    );
  };
  // Going back keeps a word fully built; one half-built stays on the device as it was.
  const back = () => move(draft.current ?? undefined, position - 1);
  const timed = attempt.kind === 'test';

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
          <LessonProgress answered={attempt.answered} total={attempt.total} />
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
            attempt={attempt}
            busy={busy || timeUp}
            onOpen={(index) => move(undefined, index)}
            onBack={() => setChecking(false)}
            onHandIn={() => void call(() => api.submitTest(attempt.id))}
          />
        ) : (
          question && (
            <div key={question.id} className={lesson.cardWrap}>
              <SpellingExercise
                exercise={question}
                storageKey={`test:${attempt.id}:${question.id}`}
                savedAnswer={attempt.answer}
                busy={busy || timeUp}
                result={null}
                eyebrow={`${timed ? t.test : t.practice} · ${t.testWordOf(position + 1, attempt.total)}`}
                submitLabel={position === last ? t.testToCheck : t.next}
                onDraft={setDraft}
                onSubmit={(answer) => move(answer, position + 1)}
                onSkip={() => move(null, position + 1)}
                onBack={position > 0 ? back : null}
                onContinue={() => undefined}
              />
            </div>
          )
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
