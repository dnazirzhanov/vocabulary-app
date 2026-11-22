/**
 * Every essay the learner has written, laid out like the home: topics, then the questions answered
 * in a topic, then one question's attempts, newest first. A marked attempt opens its feedback; one
 * never marked opens to be sent again.
 */
import { useEffect, useMemo, useState } from 'react';
import { t, uiLanguage } from '../i18n/index.ts';
import {
  getSubmission,
  listSubmissions,
  listTopics,
  type Submission,
  type SubmissionSummary,
  type WritingQuestion,
} from './api.ts';
import { markOf } from './scoreText.ts';
import styles from './Writing.module.css';

/** Where in the archive the learner is: all topics, one topic, or one question's attempts. */
export interface ArchivePlace {
  topic?: string;
  questionId?: string;
}

interface Props {
  place: ArchivePlace;
  onGo: (place: ArchivePlace) => void;
  onBack: () => void;
  onOpen: (submission: Submission) => void;
  onRetry: (question: WritingQuestion, text: string) => void;
}

interface Group<K> {
  key: K;
  essays: SubmissionSummary[];
  best: string | null;
}

export function WritingArchive({ place, onGo, onBack, onOpen, onRetry }: Props) {
  const [essays, setEssays] = useState<SubmissionSummary[] | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [error, setError] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listSubmissions()
      .then((got) => live && setEssays(got))
      .catch(() => live && setError(true));
    // The home's topic order, so both screens read the same way; without it, newest first.
    listTopics()
      .then((got) => live && setOrder(got.map((x) => x.topic)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const topics = useMemo(() => {
    const groups = groupBy(essays ?? [], (e) => e.question_topic || t.writingArchive);
    const rank = (topic: string) => (order.includes(topic) ? order.indexOf(topic) : order.length);
    return groups.sort((a, b) => rank(a.key) - rank(b.key));
  }, [essays, order]);

  const inTopic = (essays ?? []).filter((e) => (e.question_topic || t.writingArchive) === place.topic);
  const questions = groupBy(inTopic, (e) => e.question_id);
  const attempts = inTopic.filter((e) => e.question_id === place.questionId);

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

  const title = place.questionId
    ? (attempts[0]?.question_title ?? t.writingArchive)
    : (place.topic ?? t.writingArchive);

  return (
    <main className={styles.screen}>
      <button type="button" className={styles.back} onClick={onBack}>
        ‹ {t.back}
      </button>
      {place.questionId && <p className={styles.kicker}>{place.topic}</p>}
      <h1 className={place.questionId ? styles.context : styles.title}>{title}</h1>
      {error && (
        <p role="alert" className={styles.error}>
          {t.writingLoadError}
        </p>
      )}
      {essays === null && !error && <p className={styles.muted}>{t.loading}</p>}
      {essays?.length === 0 && <p className={styles.lead}>{t.writingArchiveEmpty}</p>}

      {essays && !place.topic && (
        <ul className={styles.topicGrid} aria-label={t.writingArchive}>
          {topics.map((g) => (
            <li key={g.key}>
              <button type="button" className={styles.topicCard} onClick={() => onGo({ topic: g.key })}>
                <span className={styles.topicName}>{g.key}</span>
                <span className={styles.topicFoot}>
                  <span className={styles.topicMeta}>{t.writingEssaysCount(g.essays.length)}</span>
                  {g.best && <span className={styles.bandTag}>{g.best}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {essays && place.topic && !place.questionId && (
        <ul className={styles.list} aria-label={place.topic}>
          {questions.map((g) => (
            <li key={g.key}>
              <button
                type="button"
                className={styles.questionCard}
                onClick={() => onGo({ topic: place.topic, questionId: g.key })}
              >
                <span className={styles.questionTop}>
                  <span className={styles.topicMeta}>{t.writingAttemptsCount(g.essays.length)}</span>
                  {g.best && <span className={styles.bandTag}>{g.best}</span>}
                </span>
                <span className={styles.cardTitle}>{g.essays[0].question_title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {essays && place.questionId && (
        <section aria-labelledby="writing-attempts">
          <h2 id="writing-attempts" className={styles.sectionTitle}>
            {t.writingAttemptHistory}
          </h2>
          <ul className={styles.list}>
            {attempts.map((item) => {
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
                      {[when(item.created_at), t.writingWords(item.word_count)].join(' · ')}
                    </span>
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
        </section>
      )}
    </main>
  );
}

/** Essays grouped by a key, groups in order of their newest essay, each with its best mark. */
function groupBy<K>(essays: SubmissionSummary[], keyOf: (e: SubmissionSummary) => K): Group<K>[] {
  const groups = new Map<K, SubmissionSummary[]>();
  for (const e of essays) groups.set(keyOf(e), [...(groups.get(keyOf(e)) ?? []), e]);
  return [...groups].map(([key, list]) => ({ key, essays: list, best: bestMark(list) }));
}

function bestMark(essays: SubmissionSummary[]): string | null {
  let best: { score: number; text: string } | null = null;
  for (const e of essays) {
    const text = markOf(e);
    if (!text) continue;
    // IELTS bands (0–9) outrank the old 1–5 marks: a learner's IELTS record is what matters now.
    const score = e.band != null ? 10 + e.band : (e.overall ?? 0);
    if (!best || score > best.score) best = { score, text };
  }
  return best?.text ?? null;
}

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(uiLanguage, { day: 'numeric', month: 'short', year: 'numeric' });
}
