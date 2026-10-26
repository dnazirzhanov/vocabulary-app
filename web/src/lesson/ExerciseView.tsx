import type { ReactNode, Ref } from 'react';
import { Illustration, isIllustrationId } from '../illustrations/index.tsx';
import { partOfSpeech } from '../lib/partOfSpeech.ts';
import type {
  AttemptResult,
  ChooseMeaningExercise,
  Exercise,
  IntroduceExercise,
  TypeWordExercise,
} from '../lib/types.ts';
import { SpeakerIcon } from '../ui/icons.tsx';
import { AnswerOption, type AnswerOptionState } from './AnswerOption.tsx';
import type { RunState } from './sessionRun.ts';
import styles from './LessonScreen.module.css';

const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

function speak(word: string) {
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = 'en-US';
  utterance.rate = 0.9;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function WordHeading({ headword, headingRef }: { headword: string; headingRef: Ref<HTMLHeadingElement> }) {
  return (
    <div className={styles.wordRow}>
      <h1 ref={headingRef} tabIndex={-1} className={styles.word} lang="en">
        {headword}
      </h1>
      {canSpeak && (
        <button
          type="button"
          className={styles.listen}
          onClick={() => speak(headword)}
          aria-label="Прослушать произношение"
        >
          <SpeakerIcon />
        </button>
      )}
    </div>
  );
}

/** The sentence with the target word marked, so the learner sees it in context. */
function Highlighted({ sentence, word }: { sentence: string; word: string }) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = sentence.split(new RegExp(`\\b(${escaped})\\b`, 'i'));
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <mark key={index} className={styles.highlight}>
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** The visual focus: the word's picture when one exists, otherwise the given text.
 *  Pictures are decorative here because the word is always shown as text too. */
function Stage({ art, children }: { art: string | null | undefined; children: ReactNode }) {
  return (
    <figure className={styles.stage}>
      {isIllustrationId(art) ? <Illustration id={art} className={styles.art} /> : children}
    </figure>
  );
}

function PosTag({ pos }: { pos: string }) {
  const label = partOfSpeech(pos);
  return (
    <abbr className={styles.pos} title={label.full}>
      {label.short}
    </abbr>
  );
}

function IntroduceView({ exercise, headingRef }: { exercise: IntroduceExercise; headingRef: Ref<HTMLHeadingElement> }) {
  const { word } = exercise;
  return (
    <>
      <div className={styles.prompt}>
        <p className={styles.instruction}>Новое слово</p>
        <WordHeading headword={word.headword} headingRef={headingRef} />
        <p className={styles.meaning}>
          {word.translation} <PosTag pos={word.pos} />
        </p>
      </div>
      <Stage art={word.illustration}>
        <div className={styles.stageSentence}>
          <p lang="en">
            <Highlighted sentence={word.example} word={word.headword} />
          </p>
          <p className={styles.stageSentenceTranslation}>{word.example_ru}</p>
        </div>
      </Stage>
      {isIllustrationId(word.illustration) && (
        <div className={styles.answer}>
          <p className={styles.example} lang="en">
            <Highlighted sentence={word.example} word={word.headword} />
          </p>
          <p className={styles.exampleTranslation}>{word.example_ru}</p>
        </div>
      )}
    </>
  );
}

interface ChooseViewProps {
  exercise: ChooseMeaningExercise;
  state: RunState;
  result: AttemptResult | undefined;
  onChoose: (optionId: string) => void;
  headingRef: Ref<HTMLHeadingElement>;
}

function ChooseView({ exercise, state, result, onChoose, headingRef }: ChooseViewProps) {
  const locked = state.phase !== 'answering';
  const optionState = (optionId: string): AnswerOptionState => {
    if (!result) return optionId === state.choice ? 'selected' : 'idle';
    if (optionId === result.correct_option_id) return 'correct';
    return optionId === state.choice ? 'incorrect' : 'dimmed';
  };
  return (
    <>
      <div className={styles.prompt}>
        <p className={styles.instruction}>Выберите перевод</p>
        <WordHeading headword={exercise.word.headword} headingRef={headingRef} />
      </div>
      {/* The picture would let learners match image to meaning without reading the word,
          so it appears only once the question is answered. */}
      <Stage art={result?.answer.illustration}>
        <div className={styles.stageSentence}>
          <p lang="en">
            <Highlighted sentence={exercise.word.example} word={exercise.word.headword} />
          </p>
        </div>
      </Stage>
      <fieldset className={styles.options} disabled={locked}>
        <legend className="visually-hidden">Варианты ответа</legend>
        {exercise.options.map((option, index) => (
          <AnswerOption
            key={option.id}
            name={`answer-${exercise.id}`}
            index={index}
            label={option.label}
            state={optionState(option.id)}
            checked={option.id === state.choice}
            onSelect={() => onChoose(option.id)}
          />
        ))}
      </fieldset>
    </>
  );
}

interface TypeViewProps {
  exercise: TypeWordExercise;
  state: RunState;
  result: AttemptResult | undefined;
  onInput: (text: string) => void;
  inputRef: Ref<HTMLInputElement>;
}

function TypeView({ exercise, state, result, onInput, inputRef }: TypeViewProps) {
  const { prompt } = exercise;
  const verdict = result ? (result.correct ? 'correct' : 'incorrect') : undefined;
  return (
    <>
      <div className={styles.prompt}>
        <p className={styles.instruction}>Напишите по-английски</p>
        {prompt.cloze && (
          <p className={styles.cloze} lang="en">
            {prompt.cloze.split('____').map((part, index) =>
              index === 0 ? (
                part
              ) : (
                <span key={index}>
                  <span className={styles.blank} aria-label="пропуск" />
                  {part}
                </span>
              ),
            )}
          </p>
        )}
        <p className={styles.exampleTranslation}>{prompt.example_ru}</p>
      </div>
      <figure className={styles.stage}>
        <h1 className={styles.stagePrompt}>
          {prompt.translation} <PosTag pos={prompt.pos} />
        </h1>
      </figure>
      <div className={styles.answer}>
        <label className="visually-hidden" htmlFor={`typed-${exercise.id}`}>
          Слово по-английски
        </label>
        <input
          id={`typed-${exercise.id}`}
          ref={inputRef}
          className={styles.input}
          data-verdict={verdict}
          value={state.text}
          onChange={(event) => onInput(event.target.value)}
          readOnly={state.phase !== 'answering'}
          lang="en"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          maxLength={100}
          placeholder="Введите слово"
        />
      </div>
    </>
  );
}

interface ExerciseViewProps {
  exercise: Exercise;
  state: RunState;
  result: AttemptResult | undefined;
  onChoose: (optionId: string) => void;
  onInput: (text: string) => void;
  headingRef: Ref<HTMLHeadingElement>;
  inputRef: Ref<HTMLInputElement>;
}

export function ExerciseView({ exercise, state, result, onChoose, onInput, headingRef, inputRef }: ExerciseViewProps) {
  switch (exercise.type) {
    case 'introduce':
      return <IntroduceView exercise={exercise} headingRef={headingRef} />;
    case 'choose_meaning':
      return (
        <ChooseView exercise={exercise} state={state} result={result} onChoose={onChoose} headingRef={headingRef} />
      );
    case 'type_word':
      return <TypeView exercise={exercise} state={state} result={result} onInput={onInput} inputRef={inputRef} />;
  }
}
