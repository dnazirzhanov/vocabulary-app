import { useEffect, useRef, useState } from 'react';
import { describeError } from '../lib/api.ts';
import { countWords } from '../lib/tokens.ts';
import type { ReadingAnswer, ReadingQuestion } from '../lib/types.ts';
import { CheckIcon, CloseIcon, MicIcon } from '../ui/icons.tsx';
import { t } from '../i18n/index.ts';
import { keptAnswers, loadAnswers, mergeAnswers, saveAnswer } from './answers.ts';
import { canDictate, dictate, type Dictation } from './dictation.ts';
import { capWords } from './text.ts';
import styles from './Reading.module.css';

/**
 * «Вопросы к тексту», under the article (round 2): three with options on its facts, answered once
 * and marked at once; then two open ones, answered in writing or by voice within their limits, the
 * unsent words kept as a draft on this device, the sent answer kept to read or change any time.
 */
export function Questions({
  account,
  readingRef,
  questions,
  onEdit,
}: {
  account: string;
  readingRef: string;
  questions: ReadingQuestion[];
  /** A text of my own: its questions are mine to change. */
  onEdit?: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, ReadingAnswer>>({});
  // The device's copy at once, the server's when it comes: each question's newer answer wins, so
  // a reply that left before an answer was written never undoes it.
  useEffect(() => {
    let live = true;
    const take = (found: Record<string, ReadingAnswer>) => live && setAnswers((now) => mergeAnswers(now, found));
    void keptAnswers(readingRef).then(take);
    void loadAnswers(readingRef).then(take);
    return () => {
      live = false;
    };
  }, [readingRef]);
  if (questions.length === 0 && !onEdit) return null;
  const saved = (answer: ReadingAnswer) => setAnswers((before) => ({ ...before, [answer.question_ref]: answer }));
  return (
    <section className={styles.questions} aria-labelledby="questions-title" lang="ru">
      <div className={styles.questionsHead}>
        <h2 id="questions-title" className={styles.questionsTitle}>
          {t.questionsTitle}
        </h2>
        {onEdit && (
          <button type="button" className={styles.answerEdit} onClick={onEdit}>
            {t.editQuestions}
          </button>
        )}
      </div>
      <ol className={styles.questionList}>
        {questions.map((question) => (
          // An answer arriving (or changing) shows as sent; one being written isn't replaced.
          <li key={question.id}>
            {question.kind === 'choice' ? (
              <ChoiceCard
                key={answers[question.id]?.updated_at ?? 'none'}
                readingRef={readingRef}
                question={question}
                answer={answers[question.id]}
                onSaved={saved}
              />
            ) : (
              <OpenCard
                key={answers[question.id]?.updated_at ?? 'none'}
                account={account}
                readingRef={readingRef}
                question={question}
                answer={answers[question.id]}
                onSaved={saved}
              />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Three or four options; «Проверить» once one is picked; then the right one shown. One try. */
function ChoiceCard({
  readingRef,
  question,
  answer,
  onSaved,
}: {
  readingRef: string;
  question: ReadingQuestion;
  answer: ReadingAnswer | undefined;
  onSaved: (answer: ReadingAnswer) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const options = question.options ?? [];
  const chosen = answer?.choice ?? null;
  const done = chosen !== null;
  const check = async () => {
    if (picked === null) return;
    setProblem(null);
    try {
      onSaved(await saveAnswer(readingRef, question, '', picked));
    } catch (error) {
      setProblem(describeError(error));
    }
  };
  return (
    <div className={styles.question}>
      <p className={styles.questionText} id={`${question.id}-q`} lang="en">
        {question.q}
      </p>
      <div className={styles.options} role="radiogroup" aria-labelledby={`${question.id}-q`}>
        {options.map((option, index) => {
          const right = done && index === question.answer;
          const wrong = done && index === chosen && !right;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              lang="en"
              className={styles.option}
              aria-checked={done ? index === chosen : index === picked}
              data-right={right || undefined}
              data-wrong={wrong || undefined}
              disabled={done}
              onClick={() => setPicked(index)}
            >
              <span>{option}</span>
              {right && <CheckIcon aria-hidden="true" />}
              {wrong && <CloseIcon aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {done ? (
        <p className={answer?.correct ? styles.verdictRight : styles.verdictWrong} role="status">
          {answer?.correct ? t.correct : t.wrongTheRightOneIs(options[question.answer ?? 0] ?? '')}
        </p>
      ) : (
        <div className={styles.answerActions}>
          <button type="button" className={styles.answerSend} disabled={picked === null} onClick={() => void check()}>
            {t.checkAnswer}
          </button>
        </div>
      )}
      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

// --- drafts: an open answer's unsent words, kept on this device until sent ----------------------

const draftKey = (account: string, question: string) => `answer-draft:${account}:${question}`;

function readDraft(account: string, question: string): string | null {
  try {
    return localStorage.getItem(draftKey(account, question));
  } catch {
    return null;
  }
}

function keepDraft(account: string, question: string, text: string | null) {
  try {
    if (text === null) localStorage.removeItem(draftKey(account, question));
    else localStorage.setItem(draftKey(account, question), text);
  } catch {
    // private mode or full storage: the draft lasts while the screen is open
  }
}

function OpenCard({
  account,
  readingRef,
  question,
  answer,
  onSaved,
}: {
  account: string;
  readingRef: string;
  question: ReadingQuestion;
  answer: ReadingAnswer | undefined;
  onSaved: (answer: ReadingAnswer) => void;
}) {
  // Words written and not sent, left by going elsewhere: back as they were. A draft that is the
  // answer already sent (the page left while it was being saved) is no draft.
  const [draft] = useState(() => {
    const kept = readDraft(account, question.id);
    if (kept !== null && answer && kept.trim() === answer.text.trim()) {
      keepDraft(account, question.id, null);
      return null;
    }
    return kept;
  });
  const [editing, setEditing] = useState(!answer || draft !== null);
  const [text, setText] = useState(draft ?? answer?.text ?? '');
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dictation = useRef<Dictation | null>(null);
  useEffect(() => () => dictation.current?.stop(), []);

  const min = question.min ?? 1;
  const max = question.max ?? 500;
  const words = countWords(text);
  const fits = words >= min && words <= max;
  const counter = words > max ? styles.over : fits ? styles.fits : styles.under;

  const write = (value: string) => {
    const capped = capWords(value);
    setText(capped);
    keepDraft(account, question.id, capped);
  };

  const listen = () => {
    if (listening) {
      dictation.current?.stop();
      return;
    }
    setProblem(null);
    // What was typed stays; speech goes after it.
    const before = text.trim();
    setListening(true);
    dictation.current = dictate(
      (heard) => write(before ? `${before} ${heard}` : heard),
      (reason) => {
        setListening(false);
        dictation.current = null;
        if (reason === 'blocked') setProblem(t.micBlocked);
        else if (reason === 'failed') setProblem(t.micFailed);
      },
    );
  };

  const send = async () => {
    if (!fits || busy) return;
    dictation.current?.stop();
    setBusy(true);
    setProblem(null);
    try {
      const saved = await saveAnswer(readingRef, question, text);
      keepDraft(account, question.id, null);
      onSaved(saved);
      setEditing(false);
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.question}>
      <p className={styles.questionText} lang="en">
        {question.q}
      </p>
      {!editing && answer ? (
        <>
          <p className={styles.answerText} lang="en">
            {answer.text}
          </p>
          <button type="button" className={styles.answerEdit} onClick={() => (setText(answer.text), setEditing(true))}>
            {t.edit}
          </button>
        </>
      ) : (
        <>
          <textarea
            className={styles.answerBox}
            lang="en"
            rows={4}
            value={text}
            placeholder={t.yourAnswer}
            aria-label={`${t.yourAnswer}: ${question.q}`}
            onChange={(event) => write(event.target.value)}
          />
          <div className={styles.answerBar}>
            <span className={counter} aria-live="polite">
              {t.wordsRange(words, min, max)}
            </span>
            {canDictate() && (
              <button type="button" className={styles.mic} aria-pressed={listening} onClick={listen}>
                <MicIcon aria-hidden="true" /> {listening ? t.stopSpeaking : t.speak}
              </button>
            )}
          </div>
          {listening && (
            <p className={styles.listening} role="status">
              {t.listening}
            </p>
          )}
          {problem && (
            <p className={styles.problem} role="alert">
              {problem}
            </p>
          )}
          <div className={styles.answerActions}>
            <button type="button" className={styles.answerSend} disabled={!fits || busy} onClick={() => void send()}>
              {t.send}
            </button>
            {answer && (
              <button
                type="button"
                className={styles.answerCancel}
                onClick={() => (keepDraft(account, question.id, null), setEditing(false))}
              >
                {t.cancel}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
