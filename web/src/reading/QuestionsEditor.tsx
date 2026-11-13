import type { GivenQuestion, ReadingQuestion } from '../lib/types.ts';
import { CloseIcon, PlusIcon } from '../ui/icons.tsx';
import { t } from '../i18n/index.ts';
import styles from './GiveReading.module.css';

/** At most this many questions on a text, and options on one (the server's limits). */
const MAX_QUESTIONS = 10;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;

/** A text's questions as an editor starts from them: each keeps its id, so its answers stay. */
export const editable = (questions: ReadingQuestion[]): GivenQuestion[] =>
  questions.map((one) =>
    one.kind === 'choice'
      ? { id: one.id, kind: 'choice', q: one.q, options: [...(one.options ?? [])], answer: one.answer ?? 0 }
      : { id: one.id, kind: 'open', q: one.q, min: one.min ?? 30, max: one.max ?? 150 },
  );

/** Whether a question can be saved: its text; 2–4 different options; open limits in order. */
export function sound(question: GivenQuestion): boolean {
  if (!question.q.trim()) return false;
  if (question.kind === 'choice') {
    const options = (question.options ?? []).map((option) => option.trim());
    return (
      options.every(Boolean) &&
      new Set(options).size === options.length &&
      options.length >= MIN_OPTIONS &&
      (question.answer ?? -1) < options.length
    );
  }
  return (question.min ?? 0) >= 1 && (question.min ?? 0) <= (question.max ?? 0) && (question.max ?? 0) <= 500;
}

/** A true-or-false question: its two options are «True» and «False», nothing to add. */
const isTrueFalse = (question: GivenQuestion) =>
  question.options?.length === 2 && question.options[0] === 'True' && question.options[1] === 'False';

/** The three kinds one can add: with options, true or false, open. */
const NEW: Record<'choice' | 'trueFalse' | 'open', () => GivenQuestion> = {
  choice: () => ({ kind: 'choice', q: '', options: ['', '', ''], answer: 0 }),
  // English options: the question is about an English text.
  trueFalse: () => ({ kind: 'choice', q: '', options: ['True', 'False'], answer: 0 }),
  open: () => ({ kind: 'open', q: '', min: 30, max: 150 }),
};

/**
 * Questions to change, drop or add (round 2): the AI's draft, or a library article's, is only a
 * start. A question with options marks its right one; a true-or-false one is two options; an open
 * one has its word limits. Used for one's own text and for a reading given to a group.
 */
export function QuestionsEditor({
  questions,
  onChange,
}: {
  questions: GivenQuestion[];
  onChange: (questions: GivenQuestion[]) => void;
}) {
  const change = (index: number, update: Partial<GivenQuestion>) =>
    onChange(questions.map((one, at) => (at === index ? { ...one, ...update } : one)));
  const options = (question: GivenQuestion) => question.options ?? [];
  const setOptions = (index: number, next: string[], answer: number) =>
    change(index, { options: next, answer: Math.min(answer, next.length - 1) });

  return (
    <>
      <ol className={styles.questions}>
        {questions.map((question, index) => (
          <li key={question.id ?? `new-${index}`} className={styles.question}>
            <div className={styles.questionHead}>
              <textarea
                lang="en"
                rows={2}
                value={question.q}
                aria-label={`${t.questionsTitle} ${index + 1}`}
                onChange={(event) => change(index, { q: event.target.value })}
              />
              <button
                type="button"
                className={styles.drop}
                aria-label={`${t.dropQuestion} ${index + 1}`}
                onClick={() => onChange(questions.filter((_, at) => at !== index))}
              >
                <CloseIcon aria-hidden="true" />
              </button>
            </div>
            {question.kind === 'choice' ? (
              <div className={styles.options} role="radiogroup" aria-label={`${t.theRightOne} ${index + 1}`}>
                {options(question).map((option, at) => (
                  <div key={at} className={styles.option}>
                    <input
                      type="radio"
                      name={`right-${index}`}
                      checked={question.answer === at}
                      aria-label={`${t.theRightOne}: ${t.optionN(at + 1)}`}
                      onChange={() => change(index, { answer: at })}
                    />
                    <input
                      lang="en"
                      value={option}
                      aria-label={`${t.optionN(at + 1)} (${index + 1})`}
                      onChange={(event) =>
                        change(index, {
                          options: options(question).map((one, i) => (i === at ? event.target.value : one)),
                        })
                      }
                    />
                    {options(question).length > MIN_OPTIONS && (
                      <button
                        type="button"
                        className={styles.drop}
                        aria-label={`${t.dropOption}: ${t.optionN(at + 1)} (${index + 1})`}
                        onClick={() =>
                          setOptions(
                            index,
                            options(question).filter((_, i) => i !== at),
                            (question.answer ?? 0) > at ? (question.answer ?? 0) - 1 : (question.answer ?? 0),
                          )
                        }
                      >
                        <CloseIcon aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))}
                {options(question).length < MAX_OPTIONS && !isTrueFalse(question) && (
                  <button
                    type="button"
                    className={styles.more}
                    onClick={() => setOptions(index, [...options(question), ''], question.answer ?? 0)}
                  >
                    <PlusIcon aria-hidden="true" /> {t.addOption}
                  </button>
                )}
              </div>
            ) : (
              <div className={styles.limits}>
                <label>
                  <span>{t.minWordsLabel}</span>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={question.min ?? 1}
                    onChange={(event) => change(index, { min: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <span>{t.maxWordsLabel}</span>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={question.max ?? 150}
                    onChange={(event) => change(index, { max: Number(event.target.value) })}
                  />
                </label>
              </div>
            )}
          </li>
        ))}
      </ol>
      {questions.length < MAX_QUESTIONS && (
        <div className={styles.addKinds}>
          <span>{t.addQuestion}:</span>
          <button type="button" onClick={() => onChange([...questions, NEW.choice()])}>
            <PlusIcon aria-hidden="true" /> {t.withOptions}
          </button>
          <button type="button" onClick={() => onChange([...questions, NEW.trueFalse()])}>
            <PlusIcon aria-hidden="true" /> {t.trueOrFalse}
          </button>
          <button type="button" onClick={() => onChange([...questions, NEW.open()])}>
            <PlusIcon aria-hidden="true" /> {t.openQuestion}
          </button>
        </div>
      )}
    </>
  );
}
