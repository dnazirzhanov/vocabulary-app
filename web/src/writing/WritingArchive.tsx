/**
 * Every essay the learner has written, newest first: when, which question, how it begins, its
 * length and its mark. A marked essay opens its feedback; one never marked opens to be sent again.
 */
import { useEffect, useState } from 'react';
import { t, uiLanguage } from '../i18n/index.ts';
import {
  getSubmission,
  listSubmissions,
  type Submission,
  type SubmissionSummary,
  type WritingQuestion,
} from './api.ts';
import { markOf } from './scoreText.ts';
import styles from './Writing.module.css';

interface Props {
  onBack: () => void;
  onOpen: (submission: Submission) => void;
  onRetry: (question: WritingQuestion, text: string) => void;
}

export function WritingArchive({ onBack, onOpen, onRetry }: Props) {
  const [essays, setEssays] = useState<SubmissionSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listSubmissions()
      .then((got) => live && setEssays(got))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, []);

  const open = async (item: SubmissionSummary) => {
    setOpening(item.id);
    try {
      const full = await getSubmission(item.id);
      if (full.status === 'done' && full.evaluation) onOpen(full);
      else if (full.question) onRetry(full.question, full.answer);
      else setOpening(null);
    } catch {
      setOpening(null);
      setError(true);
    }
  };

  return (
    <main className={styles.screen}>
      <button type="button" className={styles.back} onClick={onBack}>
        ‹ {t.back}
      </button>
      <h1 className={styles.title}>{t.writingArchive}</h1>
      {error && (
        <p role="alert" className={styles.error}>
          {t.writingLoadError}
        </p>
      )}
      {essays === null && !error && <p className={styles.muted}>{t.loading}</p>}
      {essays?.length === 0 && <p className={styles.lead}>{t.writingArchiveEmpty}</p>}
      {essays && essays.length > 0 && (
        <ul className={styles.list} aria-label={t.writingArchive}>
          {essays.map((item) => {
            const marked = markOf(item);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={styles.archiveItem}
                  onClick={() => void open(item)}
                  disabled={opening === item.id}
                >
                  <span className={styles.essayMeta}>
                    {[when(item.created_at), t.writingWords(item.word_count), item.cefr_level]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className={styles.essayTitle}>{item.question_title}</span>
                  {item.excerpt && (
                    <span className={styles.essayExcerpt} lang="en">
                      {item.excerpt}
                    </span>
                  )}
                  <span className={marked ? styles.essayMark : styles.essayUnmarked}>
                    {marked ?? t.writingNotChecked}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(uiLanguage, { day: 'numeric', month: 'short', year: 'numeric' });
}
