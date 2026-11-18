import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/apiError.ts';
import { t } from '../i18n/index.ts';
import { submitAnswer, type Submission, type WritingQuestion } from './api.ts';
import { clock, elapsed, idle, start, stop, timeToSubmit, type Stopwatch } from './stopwatch.ts';
import styles from './Writing.module.css';

interface Props {
  question: WritingQuestion;
  /** An earlier answer to carry on from (writing it again, or after a failed check). */
  initialText?: string;
  onBack: () => void;
  onDone: (submission: Submission) => void;
}

const draftKey = (id: string) => `writing-draft:${id}`;

// A draft survives leaving the page; storage may be blocked (private mode), so never rely on it.
function loadDraft(id: string): string {
  try {
    return localStorage.getItem(draftKey(id)) ?? '';
  } catch {
    return '';
  }
}
function saveDraft(id: string, text: string): void {
  try {
    if (text) localStorage.setItem(draftKey(id), text);
    else localStorage.removeItem(draftKey(id));
  } catch {
    // Not saved; the text is still in the box.
  }
}

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.kind === 'network') return t.writingErrorNetwork;
    if (error.code === 'writing_limit') return t.writingErrorLimit;
    if (error.code === 'answer_too_long') return t.writingErrorTooLong;
    if (error.status >= 500) return t.writingErrorService;
  }
  return t.writingErrorGeneric;
}

export function WriteScreen({ question, initialText, onBack, onDone }: Props) {
  const [text, setText] = useState(() => initialText ?? loadDraft(question.id));
  const [watch, setWatch] = useState<Stopwatch>(idle);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One id per attempt: a double tap or a retry after a failure is the same attempt to the server.
  const attempt = useRef(crypto.randomUUID());
  const sending = useRef(false);

  useEffect(() => saveDraft(question.id, text), [question.id, text]);

  const running = watch.since !== null;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  const toggleTimer = () => {
    const at = Date.now();
    setNow(at);
    setWatch((w) => (w.since === null ? start(w, at) : stop(w, at)));
  };

  const submit = async () => {
    if (sending.current) return; // a second tap before the first has been answered
    if (!text.trim()) {
      setError(t.writingErrorEmpty);
      return;
    }
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const at = Date.now();
      const submission = await submitAnswer({
        clientId: attempt.current,
        questionId: question.id,
        answer: text,
        timeSpentSeconds: timeToSubmit(watch, at),
      });
      saveDraft(question.id, '');
      onDone(submission);
    } catch (e) {
      // The text stays in the box (and in the draft); the same attempt id is used again.
      setError(errorText(e));
      setBusy(false);
    } finally {
      sending.current = false;
    }
  };

  return (
    <main className={styles.writeScreen}>
      <button type="button" className={styles.back} onClick={onBack} disabled={busy}>
        ‹ {t.back}
      </button>
      <h1 className={styles.question}>{question.title}</h1>
      <p className={styles.instruction}>{question.instruction}</p>

      <label htmlFor="writing-answer" className={styles.visuallyHidden}>
        {t.writingYourAnswer}
      </label>
      {/* One writing surface: the count and the timer live in its footer, so they cannot collide with it. */}
      <div className={styles.paper}>
        <textarea
          id="writing-answer"
          className={styles.textarea}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.writingPlaceholder}
          readOnly={busy}
          spellCheck
          autoCapitalize="sentences"
          lang="en"
        />
        <div className={styles.paperFoot} data-testid="writing-footer">
          <span className={styles.words}>{t.writingWords(wordCount(text))}</span>
          <button
            type="button"
            className={running ? `${styles.timer} ${styles.timerOn}` : styles.timer}
            onClick={toggleTimer}
            disabled={busy}
          >
            {running ? t.writingTimerStop : watch.used ? t.writingTimerResume : t.writingTimerStart}
            {watch.used && (
              <span className={styles.time} aria-live="off">
                {clock(elapsed(watch, now))}
              </span>
            )}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {busy && (
        <p role="status" className={styles.muted}>
          {t.writingChecking}
        </p>
      )}
      <button type="button" className={styles.submit} onClick={() => void submit()} disabled={busy || !text.trim()}>
        {busy ? t.writingCheckingShort : error ? t.writingTryAgain : t.writingSubmit}
      </button>
    </main>
  );
}
