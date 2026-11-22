import { useEffect, useState } from 'react';
import { t } from '../i18n/index.ts';
import {
  getSession,
  listSessions,
  type SessionSummary,
  type SpeakingQuestion,
  type SpeakingSessionDetail,
} from './api.ts';
import styles from './QuestionScreen.module.css';
import { BackButton } from '../ui/BackButton.tsx';

interface QuestionScreenProps {
  question: SpeakingQuestion;
  onRecord: () => void;
  onViewAttempt: (session: SpeakingSessionDetail) => void;
  onBack: () => void;
}

export function QuestionScreen({ question, onRecord, onViewAttempt, onBack }: QuestionScreenProps) {
  const [attempts, setAttempts] = useState<SessionSummary[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSessions(question.id)
      .then((sessions) => {
        if (!cancelled) setAttempts(sessions);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [question.id]);

  async function openAttempt(id: string) {
    setLoadingId(id);
    try {
      const d = await getSession(id);
      onViewAttempt(d);
    } finally {
      setLoadingId(null);
    }
  }

  const doneAttempts = attempts.filter((a) => a.status === 'done');
  const pendingAttempts = attempts.filter((a) => a.status !== 'done');

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <BackButton onClick={onBack} />
        <h1 className={styles.title}>{t.speakingQuestionDetailHeading}</h1>
      </header>

      <div className={styles.body}>
        <div className={styles.questionBox}>
          {question.exercise_type === 'pronunciation' && question.reference_text ? (
            <>
              <p className={styles.questionLabel}>{t.speakingReadAloud}</p>
              <p className={styles.referenceText}>{question.reference_text}</p>
            </>
          ) : (
            <p className={styles.questionText}>{question.text}</p>
          )}
          {question.level && <span className={styles.level}>{question.level}</span>}
        </div>

        <button type="button" className={styles.recordBtn} onClick={onRecord}>
          {t.speakingNewAttempt}
        </button>

        {attempts.length > 0 && (
          <section className={styles.attempts}>
            <h2 className={styles.attemptsHeading}>{t.speakingAttemptsHeading}</h2>

            {pendingAttempts.length > 0 && (
              <ul className={styles.list}>
                {pendingAttempts.map((a) => (
                  <li key={a.id} className={styles.attemptRow}>
                    <span className={styles.attemptDate}>{formatDate(a.started_at)}</span>
                    <span className={styles.pendingBadge}>{statusLabel(a.status)}</span>
                  </li>
                ))}
              </ul>
            )}

            <ul className={styles.list}>
              {doneAttempts.map((a, i) => (
                <li key={a.id} className={styles.attemptItem}>
                  <button
                    type="button"
                    className={styles.attemptRow}
                    onClick={() => void openAttempt(a.id)}
                    disabled={loadingId === a.id}
                  >
                    <span className={styles.attemptNum}>#{doneAttempts.length - i}</span>
                    <span className={styles.attemptDate}>{formatDate(a.started_at)}</span>
                    {a.overall_score !== null && <span className={styles.score}>{Math.round(a.overall_score)}%</span>}
                    <span className={styles.chevron}>{loadingId === a.id ? '…' : '▸'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
}

function statusLabel(status: string): string {
  if (status === 'processing' || status === 'uploaded') return t.speakingStatusProcessing;
  if (status === 'failed') return t.speakingStatusFailed;
  return status;
}
