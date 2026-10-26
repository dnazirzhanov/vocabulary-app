import { useEffect, useReducer, useRef, type FormEvent } from 'react';
import { api, describeError } from '../lib/api.ts';
import type { AttemptResult, Exercise, Session, Summary } from '../lib/types.ts';
import { CloseIcon } from '../ui/icons.tsx';
import { ActionBar, type ActionBarState } from './ActionBar.tsx';
import { ExerciseView } from './ExerciseView.tsx';
import { LessonProgress } from './LessonProgress.tsx';
import { reduceRun, responseFor, startRun, type RunAction, type RunState } from './sessionRun.ts';
import styles from './LessonScreen.module.css';

interface LessonScreenProps {
  session: Session;
  onComplete: (summary: Summary) => void;
  /** Leaving is safe: every answer is already saved, and the session resumes from home. */
  onExit: () => void;
}

function feedbackDetail(exercise: Exercise, result: AttemptResult) {
  const { headword, translation } = result.answer;
  if (result.correct) {
    return (
      <>
        <span lang="en">{headword}</span> — {translation}
      </>
    );
  }
  return exercise.type === 'type_word' ? (
    <>
      Правильно: <strong lang="en">{headword}</strong>
    </>
  ) : (
    <>
      Правильный ответ: <strong>{translation}</strong>
    </>
  );
}

export function LessonScreen({ session, onComplete, onExit }: LessonScreenProps) {
  const { exercises } = session;
  const [state, dispatch] = useReducer(
    (current: RunState, action: RunAction) => reduceRun(current, action, exercises),
    session,
    startRun,
  );
  // While finishing, the last exercise stays on screen with its feedback.
  const shownIndex = Math.min(state.index, exercises.length - 1);
  const exercise = exercises[shownIndex];
  const result = state.results[shownIndex];

  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const optionsRef = useRef<HTMLFieldSetElement>(null);
  const inflight = useRef<string | null>(null);

  // Server round trips follow the phase. The ref keeps one request per step even when an
  // effect runs twice; the server's one-attempt-per-exercise rule is the real guarantee.
  useEffect(() => {
    if (state.phase === 'checking') {
      const current = exercises[state.index];
      const response = responseFor(current, state);
      const key = `attempt:${current.id}`;
      if (!response || inflight.current === key) return;
      inflight.current = key;
      api
        .submitAttempt(session.id, current.id, response)
        .then(
          (attempt) => dispatch({ type: 'resolved', result: attempt }),
          (error: unknown) => dispatch({ type: 'failed', message: describeError(error) }),
        )
        .finally(() => {
          inflight.current = null;
        });
    }
    if (state.phase === 'finishing' && inflight.current !== 'finish') {
      inflight.current = 'finish';
      api
        .completeSession(session.id)
        .then(onComplete, (error: unknown) => dispatch({ type: 'failed', message: describeError(error) }))
        .finally(() => {
          inflight.current = null;
        });
    }
  }, [state, exercises, session.id, onComplete]);

  // Focus follows the flow: the new word (or the input), then the button that moves on.
  useEffect(() => {
    if (state.phase !== 'answering') return;
    if (exercises[state.index]?.type === 'type_word') inputRef.current?.focus();
    else headingRef.current?.focus();
  }, [state.index, state.phase, exercises]);
  useEffect(() => {
    if (state.phase === 'feedback' || state.phase === 'error') buttonRef.current?.focus();
  }, [state.phase]);
  // Revealed recall options take focus, so the keyboard can go straight to choosing.
  useEffect(() => {
    if (state.revealed) optionsRef.current?.querySelector('input')?.focus();
  }, [state.revealed]);

  // Keyboard: 1–4 pick an option; Enter checks or continues when focus is not on a control.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as Element;
      const position = Number(event.key);
      const choosing = exercise.type === 'choose_meaning' || exercise.type === 'recall_meaning';
      if (choosing && Number.isInteger(position) && position >= 1) {
        const option = exercise.options[position - 1];
        if (option) dispatch({ type: 'choose', optionId: option.id });
      } else if (event.key === 'Enter' && !target.closest('button, input, a, select, textarea')) {
        // Focus moves to Continue synchronously; without this the same key press would also activate it.
        event.preventDefault();
        dispatch({ type: state.phase === 'feedback' ? 'continue' : 'submit' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exercise, state.phase]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    dispatch({ type: 'submit' });
  };

  let bar: ActionBarState;
  if (state.phase === 'error') {
    bar = { kind: 'problem', message: state.error ?? describeError(null), onRetry: () => dispatch({ type: 'retry' }) };
  } else if ((state.phase === 'feedback' || state.phase === 'finishing') && result?.correct != null) {
    bar = {
      kind: 'feedback',
      correct: result.correct,
      detail: feedbackDetail(exercise, result),
      busy: state.phase === 'finishing',
      onContinue: () => dispatch({ type: 'continue' }),
    };
  } else {
    const revealing = exercise.type === 'recall_meaning' && !state.revealed;
    bar = {
      kind: 'submit',
      label: exercise.type === 'introduce' ? 'Дальше' : revealing ? 'Показать варианты' : 'Проверить',
      // Nothing is being checked on an introduction; the label simply holds while it saves.
      busyLabel: exercise.type === 'introduce' ? 'Дальше' : 'Проверяем…',
      disabled: !revealing && !responseFor(exercise, state),
      busy: state.phase === 'checking' || state.phase === 'finishing',
    };
  }

  return (
    <div className={styles.screen}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <button type="button" className={styles.exit} onClick={onExit} aria-label="Выйти из урока">
            <CloseIcon />
          </button>
          <LessonProgress answered={state.results.length} total={exercises.length} />
        </div>
      </header>

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <main className={styles.main}>
          <div key={exercise.id} className={styles.exercise} data-type={exercise.type}>
            <ExerciseView
              exercise={exercise}
              state={state}
              result={result}
              onChoose={(optionId) => dispatch({ type: 'choose', optionId })}
              onInput={(text) => dispatch({ type: 'input', text })}
              headingRef={headingRef}
              inputRef={inputRef}
              optionsRef={optionsRef}
            />
          </div>
        </main>
        <ActionBar state={bar} buttonRef={buttonRef} />
      </form>
    </div>
  );
}
