import { useEffect, useState } from 'react';
import { t } from '../i18n/index.ts';
import { listQuestions, type WritingQuestion } from './api.ts';
import styles from './Writing.module.css';

interface Props {
  topic: string;
  onBack: () => void;
  onPick: (question: WritingQuestion) => void;
}

export function QuestionList({ topic, onBack, onPick }: Props) {
  const [questions, setQuestions] = useState<WritingQuestion[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    listQuestions(topic)
      .then((got) => live && setQuestions(got))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [topic]);

  return (
    <main className={styles.screen}>
      <button type="button" className={styles.back} onClick={onBack}>
        ‹ {t.back}
      </button>
      <h1 className={styles.title}>{topic}</h1>
      <p className={styles.lead}>{t.writingChooseQuestion}</p>
      {error && (
        <p role="alert" className={styles.error}>
          {t.writingLoadError}
        </p>
      )}
      {questions === null && !error && <p className={styles.muted}>{t.loading}</p>}
      <ul className={styles.list}>
        {questions?.map((q) => (
          <li key={q.id}>
            <button type="button" className={styles.card} onClick={() => onPick(q)}>
              <span className={styles.cardTitle}>{q.title}</span>
              <span className={styles.cardText}>{q.instruction}</span>
              <span className={styles.chips}>
                {q.level && <span className={styles.chip}>{q.level}</span>}
                {q.suggested_minutes && <span className={styles.chip}>{t.writingMinutes(q.suggested_minutes)}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
