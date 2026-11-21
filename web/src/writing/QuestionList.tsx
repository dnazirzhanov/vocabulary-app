import { useEffect, useState } from 'react';
import { t } from '../i18n/index.ts';
import { listQuestions, listSubmissions, type WritingQuestion } from './api.ts';
import { markOf, taskTypeLabel } from './scoreText.ts';
import styles from './Writing.module.css';

interface Props {
  topic: string;
  onBack: () => void;
  onPick: (question: WritingQuestion) => void;
}

export function QuestionList({ topic, onBack, onPick }: Props) {
  const [questions, setQuestions] = useState<WritingQuestion[] | null>(null);
  const [done, setDone] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    listQuestions(topic)
      .then((got) => live && setQuestions(got))
      .catch(() => live && setError(true));
    // The learner's best mark on each question, if any: a bonus, so a failure is quiet.
    listSubmissions()
      .then((mine) => {
        if (!live) return;
        const best = new Map<string, { band: number; text: string }>();
        for (const item of mine) {
          const text = markOf(item);
          if (!text) continue;
          const band = item.band ?? item.overall ?? 0;
          if ((best.get(item.question_id)?.band ?? -1) < band) best.set(item.question_id, { band, text });
        }
        setDone(new Map([...best].map(([id, b]) => [id, b.text])));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [topic]);

  // Every question shares the exam's instruction: said once, above them.
  const instruction = questions?.find((q) => q.task_type)?.instruction;

  return (
    <main className={styles.screen}>
      <button type="button" className={styles.back} onClick={onBack}>
        ‹ {t.back}
      </button>
      <h1 className={styles.title}>{topic}</h1>
      <p className={styles.lead}>{instruction ?? t.writingChooseQuestion}</p>
      {error && (
        <p role="alert" className={styles.error}>
          {t.writingLoadError}
        </p>
      )}
      {questions === null && !error && <p className={styles.muted}>{t.loading}</p>}
      <ul className={styles.list}>
        {questions?.map((q) => (
          <li key={q.id}>
            <button type="button" className={styles.questionCard} onClick={() => onPick(q)}>
              <span className={styles.questionTop}>
                {q.task_type && <span className={styles.typeChip}>{taskTypeLabel(q.task_type)}</span>}
                {done.get(q.id) && <span className={styles.bandTag}>{done.get(q.id)}</span>}
              </span>
              <span className={styles.cardTitle}>{q.title}</span>
              {!q.task_type && <span className={styles.cardText}>{q.instruction}</span>}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
