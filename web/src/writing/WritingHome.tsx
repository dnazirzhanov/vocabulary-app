import { useEffect, useState } from 'react';
import { t } from '../i18n/index.ts';
import {
  getSubmission,
  listSubmissions,
  listTopics,
  type Submission,
  type SubmissionSummary,
  type Topic,
  type WritingQuestion,
} from './api.ts';
import { scoreLabel } from './scoreText.ts';
import styles from './Writing.module.css';

interface Props {
  onPickTopic: (topic: string) => void;
  onOpen: (submission: Submission) => void;
  onRetry: (question: WritingQuestion, text: string) => void;
}

export function WritingHome({ onPickTopic, onOpen, onRetry }: Props) {
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [mine, setMine] = useState<SubmissionSummary[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    listTopics()
      .then((got) => live && setTopics(got))
      .catch(() => live && setError(true));
    // The past answers are a bonus: if they don't load, the topics are still there.
    listSubmissions()
      .then((got) => live && setMine(got.slice(0, 5)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const open = async (item: SubmissionSummary) => {
    try {
      const full = await getSubmission(item.id);
      if (full.status === 'done' && full.evaluation) onOpen(full);
      else if (full.question) onRetry(full.question, full.answer);
    } catch {
      setError(true);
    }
  };

  return (
    <main className={styles.screen}>
      <h1 className={styles.title}>{t.writing}</h1>
      <p className={styles.lead}>{t.writingChooseTopic}</p>
      {error && (
        <p role="alert" className={styles.error}>
          {t.writingLoadError}
        </p>
      )}
      {topics === null && !error && <p className={styles.muted}>{t.loading}</p>}
      <ul className={styles.list}>
        {topics?.map((topic) => (
          <li key={topic.topic}>
            <button type="button" className={styles.row} onClick={() => onPickTopic(topic.topic)}>
              <span className={styles.rowName}>{topic.topic}</span>
              <span className={styles.rowMeta}>{t.writingQuestionsCount(topic.question_count)}</span>
              <span aria-hidden="true">›</span>
            </button>
          </li>
        ))}
      </ul>
      {mine.length > 0 && (
        <section aria-labelledby="writing-mine">
          <h2 id="writing-mine" className={styles.sectionTitle}>
            {t.writingMyAnswers}
          </h2>
          <ul className={styles.list}>
            {mine.map((item) => (
              <li key={item.id}>
                <button type="button" className={styles.row} onClick={() => void open(item)}>
                  <span className={styles.rowName}>{item.question_title}</span>
                  <span className={styles.rowMeta}>
                    {item.status === 'done' && item.overall ? scoreLabel(item.overall) : t.writingNotChecked}
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
