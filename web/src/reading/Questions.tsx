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
 * «Вопросы к тексту», under the article (round 2), one card at a time (Daler, 22 November 2026: not a
 * long list): three with options on its facts, answered once and marked at once; then two open ones,
 * answered in writing or by voice within their limits, the unsent words kept as a draft on this
 * device, the sent answer kept to read or change any time. Numbered dots go to any question; it
 * opens on the first one not yet answered.
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
  // The card the learner moved to; until then, the first question not yet answered.
  const [chosen, setChosen] = useState<number | null>(null);
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
  const at = Math.min(chosen ?? firstOpen(questions, answers), Math.max(questions.length - 1, 0));
  if (questions.length === 0 && !onEdit) return null;
  const saved = (answer: ReadingAnswer) => {
    // Stay on this card to see the verdict, rather than following the next one unanswered.
    setChosen(at);
    setAnswers((before) => ({ ...before, [answer.question_ref]: answer }));
  };
  const go = (n: number) => setChosen(Math.max(0, Math.min(questions.length - 1, n)));
  const question = questions[at];
  const answered = question ? Boolean(answers[question.id]) : false;
  const allDone = questions.length > 0 && questions.every((q) => answers[q.id]);
  const last = at >= questions.length - 1;
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
      {question && (
        <>
          <div className={styles.questionDots} role="group" aria-label={t.questionsTitle}>
            {questions.map((q, n) => (
              <button
                key={q.id}
                type="button"
                className={styles.questionDot}
                aria-label={t.questionNumber(n + 1)}
                aria-current={n === at ? 'step' : undefined}
                data-done={doneMark(q, answers[q.id])}
                onClick={() => go(n)}
              >
                {n + 1}
              </button>
            ))}
          </div>
          <article className={styles.questionCard} aria-label={t.questionOf(at + 1, questions.length)}>
            <p className={styles.questionCount}>{t.questionOf(at + 1, questions.length)}</p>
            {/* An answer arriving (or changing) shows as sent; one being written isn't replaced. */}
            {question.kind === 'choice' ? (
              <ChoiceCard
                key={`${question.id}:${answers[question.id]?.updated_at ?? 'none'}`}
                readingRef={readingRef}
                question={question}
                answer={answers[question.id]}
                onSaved={saved}
              />
            ) : (
              <OpenCard
                key={`${question.id}:${answers[question.id]?.updated_at ?? 'none'}`}
                account={account}
                readingRef={readingRef}
                question={question}
                answer={answers[question.id]}
                onSaved={saved}
              />
            )}
            {allDone && last && (
              <p className={styles.verdictRight} role="status">
                <CheckIcon aria-hidden="true" /> {t.questionsAllDone}
              </p>
            )}
          </article>
          <div className={styles.questionNav}>
            <button type="button" className={styles.answerCancel} disabled={at === 0} onClick={() => go(at - 1)}>
              ‹ {t.questionPrev}
            </button>
            {!last && (
              <button
                type="button"
                className={answered ? styles.answerSend : styles.answerCancel}
                onClick={() => go(at + 1)}
              >
                {t.questionNext} ›
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** How an answered question's dot looks: right or wrong for options, sent for an open one. */
function doneMark(question: ReadingQuestion, answer: ReadingAnswer | undefined): string | undefined {
  if (!answer) return undefined;
  if (question.kind !== 'choice') return 'sent';
  return answer.correct ? 'right' : 'wrong';
}

/** The first question without an answer; the first of all when every one is answered. */
function firstOpen(questions: ReadingQuestion[], answers: Record<string, ReadingAnswer>): number {
  const open = questions.findIndex((q) => !answers[q.id]);
  return open === -1 ? 0 : open;
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
