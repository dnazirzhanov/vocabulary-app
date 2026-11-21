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
import { bandText, markOf } from './scoreText.ts';
import styles from './Writing.module.css';

interface Props {
  onPickTopic: (topic: string) => void;
  onOpen: (submission: Submission) => void;
  onRetry: (question: WritingQuestion, text: string) => void;
  onOpenArchive: () => void;
}

/** The exam's own name, the same in every language. */
const IELTS_TASK = 'IELTS Writing · Task 2';

/** How many of the latest essays the home shows; the archive has them all. */
const LATEST = 3;

export function WritingHome({ onPickTopic, onOpen, onRetry, onOpenArchive }: Props) {
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
      .then((got) => live && setMine(got))
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

  // The learner's IELTS record so far: the last band and the best, from essays marked on IELTS.
  const bands = mine.filter((m) => m.status === 'done' && m.band != null).map((m) => m.band as number);

  return (
    <main className={styles.screen}>
      <header className={styles.homeHead}>
        <p className={styles.kicker}>{IELTS_TASK}</p>
        <h1 className={styles.title}>{t.writing}</h1>
        <p className={styles.lead}>{t.writingIeltsLead}</p>
        {bands.length > 0 && (
          <dl className={styles.record}>
            <div>
              <dt>{t.writingLastBand}</dt>
              <dd>{bandText(bands[0])}</dd>
            </div>
            <div>
              <dt>{t.writingBestBand}</dt>
              <dd>{bandText(Math.max(...bands))}</dd>
            </div>
            <div>
              <dt>{t.writingEssaysDone}</dt>
              <dd>{bands.length}</dd>
            </div>
          </dl>
        )}
      </header>
      {error && (
        <p role="alert" className={styles.error}>
          {t.writingLoadError}
        </p>
      )}
      {topics === null && !error && <p className={styles.muted}>{t.loading}</p>}
      <section aria-labelledby="writing-topics">
        <h2 id="writing-topics" className={styles.sectionTitle}>
          {t.writingChooseTopic}
        </h2>
        <ul className={styles.topicGrid}>
          {topics?.map((topic) => (
            <li key={topic.topic}>
              <button type="button" className={styles.topicCard} onClick={() => onPickTopic(topic.topic)}>
                <span className={styles.topicName}>{topic.topic}</span>
                <span className={styles.topicMeta}>{t.writingQuestionsCount(topic.question_count)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {mine.length > 0 && (
        <section aria-labelledby="writing-mine">
          <h2 id="writing-mine" className={styles.sectionTitle}>
            {t.writingMyAnswers}
          </h2>
          <ul className={styles.list}>
            {mine.slice(0, LATEST).map((item) => {
              const mark = markOf(item);
              return (
                <li key={item.id}>
                  <button type="button" className={styles.row} onClick={() => void open(item)}>
                    <span className={styles.rowName}>{item.question_title}</span>
                    <span className={mark ? styles.bandTag : styles.rowMeta}>{mark ?? t.writingNotChecked}</span>
                    <span aria-hidden="true">›</span>
                  </button>
                </li>
              );
            })}
            <li>
              <button type="button" className={`${styles.row} ${styles.allEssays}`} onClick={onOpenArchive}>
                {t.writingArchiveAll(mine.length)}
              </button>
            </li>
          </ul>
        </section>
      )}
    </main>
  );
}
