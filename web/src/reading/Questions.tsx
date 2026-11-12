import { useEffect, useRef, useState } from 'react';
import { describeError } from '../lib/api.ts';
import { countWords } from '../lib/tokens.ts';
import type { ReadingAnswer, ReadingQuestion } from '../lib/types.ts';
import { MicIcon } from '../ui/icons.tsx';
import { t } from '../i18n/index.ts';
import { keptAnswers, loadAnswers, mergeAnswers, saveAnswer } from './answers.ts';
import { capWords } from './text.ts';
import { canDictate, dictate, type Dictation } from './dictation.ts';
import styles from './Reading.module.css';

/**
 * «Вопросы к тексту», under the article (round 2, C): each question answered in writing or by
 * voice, within its word limits; an answer stays, to be read or changed whenever one likes.
 */
export function Questions({ readingRef, questions }: { readingRef: string; questions: ReadingQuestion[] }) {
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
  if (questions.length === 0) return null;
  return (
    <section className={styles.questions} aria-labelledby="questions-title" lang="ru">
      <h2 id="questions-title" className={styles.questionsTitle}>
        {t.questionsTitle}
      </h2>
      <ol className={styles.questionList}>
        {questions.map((question) => (
          // An answer arriving (or changing) shows as sent; one being written isn't replaced.
          <li key={question.id}>
            <QuestionCard
              key={answers[question.id]?.updated_at ?? 'none'}
              question={question}
              answer={answers[question.id]}
              onSaved={(saved) => setAnswers((before) => ({ ...before, [saved.question_ref]: saved }))}
              readingRef={readingRef}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}

function QuestionCard({
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
  const [editing, setEditing] = useState(!answer);
  const [text, setText] = useState(answer?.text ?? '');
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dictation = useRef<Dictation | null>(null);
  useEffect(() => () => dictation.current?.stop(), []);

  const words = countWords(text);
  const fits = words >= question.min && words <= question.max;
  const counter = words > question.max ? styles.over : fits ? styles.fits : styles.under;

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
      (heard) => setText(capWords(before ? `${before} ${heard}` : heard)),
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
      onSaved(await saveAnswer(readingRef, question, text));
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
            onChange={(event) => setText(capWords(event.target.value))}
          />
          <div className={styles.answerBar}>
            <span className={counter} aria-live="polite">
              {t.wordsRange(words, question.min, question.max)}
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
              <button type="button" className={styles.answerCancel} onClick={() => setEditing(false)}>
                {t.cancel}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
