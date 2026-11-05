import { useCallback, useEffect, useRef, useState } from 'react';
import { AnswerCompared, SpellingExercise } from '../lesson/SpellingExercise.tsx';
import { LessonProgress } from '../lesson/LessonProgress.tsx';
import lesson from '../lesson/LessonScreen.module.css';
import { api, ApiError, describeError } from '../lib/api.ts';
import { clockText, rememberRunningTest, scoreText, verdictText } from '../lib/groupTests.ts';
import type { TestAttempt } from '../lib/types.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { CloseIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import shared from '../groups/Groups.module.css';
import { useSecondsLeft } from './useSecondsLeft.ts';
import styles from './Tests.module.css';

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
 * Taking a test or a practice (ADR 0046): the lesson's screen and spelling card, one word at a time
 * from the server, with nothing said about each until the end. The order and the deadline live on
 * the server, so nothing here can reshuffle or extend them. At zero the tiles lock, a word fully
 * built is sent, and the server gives the result.
 */
export function TestRun({ groupId, deckId, attemptId, initial, onDone }: TestRunProps) {
  const [attempt, setAttempt] = useState<TestAttempt | null>(initial ?? null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const draft = useRef<string | null>(null);
  const askedAtZero = useRef(false);

  const call = useCallback(async (action: () => Promise<TestAttempt>) => {
    setBusy(true);
    setError(null);
    try {
      setAttempt(await action());
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
  useEffect(() => {
    if (!timeUp || !attempt || !question || busy || error) return;
    const timer = setTimeout(
      () => {
        const last = draft.current;
        draft.current = null;
        askedAtZero.current = true;
        void call(() => (last ? api.answerTest(attempt.id, question.id, last) : api.testAttempt(attempt.id)));
      },
      askedAtZero.current ? ASK_AGAIN_MS : 0,
    );
    return () => clearTimeout(timer);
  }, [timeUp, attempt, question, busy, error, call]);

  const mainRef = useRef<HTMLElement>(null);
  const setDraft = useCallback((answer: string | null) => {
    draft.current = answer;
    // A long word on a small phone pushes «Дальше» out of sight, and scrolling costs test time.
    if (answer !== null) mainRef.current?.scrollTo({ top: mainRef.current.scrollHeight });
  }, []);

  if (gone) {
    return (
      <main className="message-screen">
        <p role="alert">Тест изменился. Начните заново.</p>
        <PrimaryButton type="button" onClick={onDone}>
          Назад
        </PrimaryButton>
      </main>
    );
  }
  if (!attempt) {
    return (
      <main className="message-screen" aria-busy={!error}>
        {error ? <p role="alert">{error}</p> : <p>Загружаем…</p>}
        {error && (
          <PrimaryButton type="button" onClick={() => (setError(null), void load())}>
            Повторить
          </PrimaryButton>
        )}
      </main>
    );
  }
  if (attempt.result) {
    return (
      <TestResult
        attempt={attempt}
        busy={busy}
        error={error}
        onAgain={() => void call(() => api.startTestAttempt(groupId, deckId, 'practice'))}
        onDone={onDone}
      />
    );
  }

  const timed = attempt.kind === 'test';
  return (
    <div className={lesson.screen}>
      <header className={lesson.topbar}>
        <div className={lesson.topbarInner}>
          <button
            type="button"
            className={lesson.exit}
            aria-label={timed ? 'Выйти из теста' : 'Выйти из тренировки'}
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
        </div>
      </header>
      <main ref={mainRef} className={lesson.main}>
        {question && (
          <div key={question.id} className={lesson.cardWrap}>
            <SpellingExercise
              exercise={question}
              storageKey={`test:${attempt.id}:${question.id}`}
              busy={busy || timeUp}
              result={null}
              eyebrow={attempt.returning ? 'Пропущенное слово' : timed ? 'Тест' : 'Тренировка'}
              submitLabel="Дальше"
              onDraft={setDraft}
              onSubmit={(answer) => void call(() => api.answerTest(attempt.id, question.id, answer))}
              onSkip={() => void call(() => api.skipTest(attempt.id, question.id, attempt.returning))}
              onContinue={() => undefined}
            />
            {error && (
              <div className={styles.runError}>
                <p className={shared.problem} role="alert">
                  {error}
                </p>
                {timeUp && (
                  <button type="button" className={shared.smallButton} onClick={() => setError(null)}>
                    Повторить
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </main>
      <Dialog open={leaving} onClose={() => setLeaving(false)} title="Выйти из теста?">
        <div className={styles.setup}>
          <p>Время продолжает идти.</p>
          <button type="button" className={shared.smallButton} data-autofocus onClick={() => setLeaving(false)}>
            Продолжить тест
          </button>
          <button type="button" className={shared.linkButton} onClick={onDone}>
            Выйти
          </button>
        </div>
      </Dialog>
    </div>
  );
}

function TestResult(props: {
  attempt: TestAttempt;
  busy: boolean;
  error: string | null;
  onAgain: () => void;
  onDone: () => void;
}) {
  const { attempt, busy, error, onAgain, onDone } = props;
  const result = attempt.result!;
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const wrong = result.mistakes.filter((mistake) => mistake.answer !== null);
  const skipped = result.mistakes.filter((mistake) => mistake.skipped);
  const missed = result.mistakes.filter((mistake) => mistake.answer === null && !mistake.skipped);
  return (
    <div className={shared.screen}>
      <main className={`${shared.main} ${styles.resultMain}`}>
        <div className={`${shared.column} ${styles.page}`}>
          <div className={styles.head}>
            {result.timed_out && <p className={shared.note}>Время вышло</p>}
            <h1 ref={headingRef} tabIndex={-1} className={shared.title}>
              {scoreText(result)}
            </h1>
            {result.passed !== null && <p className={styles.state}>{verdictText(result.passed)}</p>}
          </div>

          {wrong.length > 0 && (
            <section aria-label="Ошибки" className={styles.mistakes}>
              <h2 className={styles.mistakesTitle}>Ошибки</h2>
              <ul>
                {wrong.map((mistake) => (
                  <li key={mistake.word}>
                    <p className={styles.meaning}>{mistake.translation}</p>
                    <AnswerCompared built={mistake.answer!} word={mistake.word} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          <WordList title="Пропущено" words={skipped} />
          <WordList title="Не успели" words={missed} />

          {error && (
            <p className={shared.problem} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <PrimaryButton type="button" onClick={onDone}>
              Готово
            </PrimaryButton>
            {attempt.kind === 'practice' && (
              <button type="button" className={shared.linkButton} disabled={busy} onClick={onAgain}>
                Ещё раз
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

/** Words never answered: each with its meaning, for going over them. */
function WordList({ title, words }: { title: string; words: { word: string; translation: string }[] }) {
  if (words.length === 0) return null;
  return (
    <section aria-label={title} className={styles.mistakes}>
      <h2 className={styles.mistakesTitle}>{title}</h2>
      <ul className={styles.weakWords}>
        {words.map((item) => (
          <li key={item.word}>
            <strong lang="en">{item.word}</strong> <span>{item.translation}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
