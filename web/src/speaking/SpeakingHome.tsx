import { useEffect, useState } from 'react';
import { t } from '../i18n/index.ts';
import { listQuestions, type SpeakingQuestion } from './api.ts';
import styles from './SpeakingHome.module.css';

interface SpeakingHomeProps {
  onSelectTopic: (topic: string, questions: SpeakingQuestion[]) => void;
  onBack: () => void;
}

interface TopicEntry {
  topic: string;
  questions: SpeakingQuestion[];
}

export function SpeakingHome({ onSelectTopic, onBack }: SpeakingHomeProps) {
  const [topics, setTopics] = useState<TopicEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listQuestions()
      .then((qs) => {
        if (cancelled) return;
        const map = new Map<string, SpeakingQuestion[]>();
        for (const q of qs) {
          const bucket = map.get(q.topic) ?? [];
          bucket.push(q);
          map.set(q.topic, bucket);
        }
        setTopics(Array.from(map.entries()).map(([topic, questions]) => ({ topic, questions })));
      })
      .catch(() => {
        if (!cancelled) setError(t.speakingLoadError);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <button type="button" className={styles.back} onClick={onBack}>
          {t.speakingBack}
        </button>
        <h1 className={styles.title}>{t.speakingTopicsHeading}</h1>
      </header>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      <ul className={styles.list}>
        {topics.map(({ topic, questions }) => (
          <li key={topic}>
            <button type="button" className={styles.topicCard} onClick={() => onSelectTopic(topic, questions)}>
              <span className={styles.topicName}>{topic}</span>
              <span className={styles.topicMeta}>
                {questions.length} {questions.length === 1 ? t.speakingQuestionSingular : t.speakingQuestionPlural}
              </span>
              <span className={styles.arrow}>›</span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
