import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Illustration } from '../illustrations/index.tsx';
import { CloseIcon, SpeakerIcon } from '../ui/icons.tsx';
import { ActionBar } from './ActionBar.tsx';
import { AnswerOption, type AnswerOptionState } from './AnswerOption.tsx';
import { LessonEnd } from './LessonEnd.tsx';
import { LessonProgress } from './LessonProgress.tsx';
import type { ChoiceExercise } from './types.ts';
import { useLessonSession } from './useLessonSession.ts';
import styles from './LessonScreen.module.css';

const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

function speak(word: string) {
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = 'en-US';
  utterance.rate = 0.9;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

export function LessonScreen({ exercises }: { exercises: readonly ChoiceExercise[] }) {
  const { state, exercise, total, lastResult, select, check, next, restart } = useLessonSession(exercises);
  const [exited, setExited] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const shownIndex = useRef(state.index);

  // Keyboard: 1–4 pick an option; Enter checks/continues when focus isn't on a control.
  useEffect(() => {
    if (state.phase === 'complete' || exited) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const position = Number(event.key);
      if (state.phase === 'answering' && Number.isInteger(position) && position >= 1) {
        const option = exercise.options[position - 1];
        if (option) select(option.id);
      } else if (event.key === 'Enter' && !(event.target as Element).closest('button, input, a, select, textarea')) {
        // Focus moves to Continue synchronously; without this the same key
        // press would also activate it and skip the feedback.
        event.preventDefault();
        if (state.phase === 'answering') check();
        else next();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state.phase, exercise, exited, select, check, next]);

  // Focus follows the flow: Continue after checking, the new word after advancing.
  useEffect(() => {
    if (state.phase === 'feedback') continueRef.current?.focus();
    if (state.phase === 'answering' && shownIndex.current !== state.index) headingRef.current?.focus();
    shownIndex.current = state.index;
  }, [state.phase, state.index]);

  if (state.phase === 'complete' || exited) {
    return (
      <LessonEnd
        reason={exited ? 'exited' : 'complete'}
        correct={state.results.filter((result) => result.correct).length}
        answered={state.results.length}
        onRestart={() => {
          setExited(false);
          restart();
        }}
      />
    );
  }

  const optionState = (optionId: string): AnswerOptionState => {
    if (state.phase === 'answering') return optionId === state.selectedId ? 'selected' : 'idle';
    if (optionId === exercise.answerId) return 'correct';
    return optionId === lastResult?.selectedId ? 'incorrect' : 'dimmed';
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    check();
  };

  const answer = exercise.options.find((option) => option.id === exercise.answerId);

  return (
    <div className={styles.screen}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <button type="button" className={styles.exit} onClick={() => setExited(true)} aria-label="Выйти из урока">
            <CloseIcon />
          </button>
          <LessonProgress answered={state.results.length} total={total} />
        </div>
      </header>

      <form className={styles.form} onSubmit={onSubmit}>
        <main className={styles.main}>
          <div key={exercise.id} className={styles.exercise}>
            <div className={styles.prompt}>
              <p className={styles.instruction}>Выберите перевод</p>
              <div className={styles.wordRow}>
                <h1 ref={headingRef} tabIndex={-1} className={styles.word} lang="en">
                  {exercise.word}
                </h1>
                {canSpeak && (
                  <button
                    type="button"
                    className={styles.listen}
                    onClick={() => speak(exercise.word)}
                    aria-label="Прослушать произношение"
                  >
                    <SpeakerIcon />
                  </button>
                )}
              </div>
            </div>

            <figure className={styles.stage}>
              <Illustration id={exercise.illustration} alt={exercise.illustrationAlt} className={styles.art} />
            </figure>

            <fieldset className={styles.options} disabled={state.phase !== 'answering'}>
              <legend className="visually-hidden">Варианты ответа</legend>
              {exercise.options.map((option, index) => (
                <AnswerOption
                  key={option.id}
                  name={`answer-${exercise.id}`}
                  index={index}
                  label={option.label}
                  state={optionState(option.id)}
                  checked={option.id === (state.phase === 'answering' ? state.selectedId : lastResult?.selectedId)}
                  onSelect={() => select(option.id)}
                />
              ))}
            </fieldset>
          </div>
        </main>

        <ActionBar
          canCheck={state.selectedId !== null}
          feedback={
            lastResult && answer
              ? { correct: lastResult.correct, word: exercise.word, answer: answer.label }
              : undefined
          }
          onContinue={next}
          continueRef={continueRef}
        />
      </form>
    </div>
  );
}
