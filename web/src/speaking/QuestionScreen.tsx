import { useEffect, useState } from 'react';
import { t } from '../i18n/index.ts';
import { getSession, listSessions, type SessionSummary, type SpeakingQuestion, type SpeakingSessionDetail } from './api.ts';
import { ScoreGrid } from './ScoreGrid.tsx';
import { PronunciationBreakdown } from './PronunciationBreakdown.tsx';
import { FeedbackList } from './FeedbackList.tsx';
import styles from './QuestionScreen.module.css';

interface QuestionScreenProps {
  question: SpeakingQuestion;
  onRecord: () => void;
  onBack: () => void;
}

export function QuestionScreen({ question, onRecord, onBack }: QuestionScreenProps) {
  const [attempts, setAttempts] = useState<SessionSummary[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<SpeakingSessionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

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

  async function toggleAttempt(id: string) {
    if (expanded === id) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(id);
    setLoadingDetail(true);
    try {
      const d = await getSession(id);
      setDetail(d);
    } finally {
      setLoadingDetail(false);
    }
  }

  const doneAttempts = attempts.filter((a) => a.status === 'done');
  const pendingAttempts = attempts.filter((a) => a.status !== 'done');

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <button type="button" className={styles.back} onClick={onBack}>
          {t.speakingBack}
        </button>
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
                    className={`${styles.attemptRow} ${expanded === a.id ? styles.expanded : ''}`}
                    onClick={() => void toggleAttempt(a.id)}
                  >
                    <span className={styles.attemptNum}>#{doneAttempts.length - i}</span>
                    <span className={styles.attemptDate}>{formatDate(a.started_at)}</span>
                    {a.overall_score !== null && (
                      <span className={styles.score}>{Math.round(a.overall_score)}%</span>
                    )}
                    <span className={styles.chevron}>{expanded === a.id ? '▾' : '▸'}</span>
                  </button>

                  {expanded === a.id && (
                    <div className={styles.detail}>
                      {loadingDetail && <p className={styles.loading}>{t.speakingLoadingDetail}</p>}
                      {!loadingDetail && detail && (
                        <>
                          {detail.assessment?.transcript && (
                            <div className={styles.transcript}>
                              <p className={styles.transcriptLabel}>{t.speakingTranscriptLabel}</p>
                              <p className={styles.transcriptText}>{detail.assessment.transcript}</p>
                            </div>
                          )}
                          {detail.assessment && <ScoreGrid assessment={detail.assessment} />}
                          {detail.assessment?.pronunciation_words && detail.assessment.pronunciation_words.length > 0 && (
                            <PronunciationBreakdown
                              words={detail.assessment.pronunciation_words}
                              pronunciationScore={detail.assessment.pronunciation_score}
                            />
                          )}
                          {detail.assessment?.feedback_items && detail.assessment.feedback_items.length > 0 && (
                            <FeedbackList items={detail.assessment.feedback_items} />
                          )}
                        </>
                      )}
                    </div>
                  )}
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
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function statusLabel(status: string): string {
  if (status === 'processing' || status === 'uploaded') return t.speakingStatusProcessing;
  if (status === 'failed') return t.speakingStatusFailed;
  return status;
}
