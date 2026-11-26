import { useEffect, useState } from 'react';
import { t } from '../i18n/index.ts';
import { listSessions, type SessionSummary, type SpeakingQuestion } from './api.ts';
import styles from './TopicScreen.module.css';
import { BackButton } from '../ui/BackButton.tsx';

interface TopicScreenProps {
  topic: string;
  questions: SpeakingQuestion[];
  onSelectQuestion: (question: SpeakingQuestion) => void;
  onBack: () => void;
}

export function TopicScreen({ topic, questions, onSelectQuestion, onBack }: TopicScreenProps) {
  const [attemptCounts, setAttemptCounts] = useState<Map<string, SessionSummary[]>>(new Map());

  useEffect(() => {
    let cancelled = false;
    listSessions()
      .then((sessions) => {
        if (cancelled) return;
        const map = new Map<string, SessionSummary[]>();
        for (const s of sessions) {
          if (s.status !== 'done' && s.status !== 'uploaded' && s.status !== 'processing') continue;
          const bucket = map.get(s.question_id) ?? [];
          bucket.push(s);
          map.set(s.question_id, bucket);
        }
        setAttemptCounts(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <BackButton onClick={onBack} />
        <h1 className={styles.title}>{topic}</h1>
      </header>

      <ul className={styles.list}>
        {questions.map((q) => {
          const attempts = attemptCounts.get(q.id) ?? [];
          const best = attempts.reduce<number | null>((max, s) => {
            if (s.overall_score === null) return max;
            return max === null ? s.overall_score : Math.max(max, s.overall_score);
          }, null);
          return (
            <li key={q.id}>
              <button type="button" className={styles.questionCard} onClick={() => onSelectQuestion(q)}>
                <div className={styles.questionText}>{q.text}</div>
                <div className={styles.questionMeta}>
                  {q.level && <span className={styles.level}>{q.level}</span>}
                  {attempts.length > 0 && (
                    <span className={styles.attempts}>
                      {attempts.length} {attempts.length === 1 ? t.speakingAttemptSingular : t.speakingAttemptPlural}
                    </span>
                  )}
                  {best !== null && <span className={styles.bestScore}>{Math.round(best)}%</span>}
                </div>
                <span className={styles.arrow}>›</span>
              </button>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
