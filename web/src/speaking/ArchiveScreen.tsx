/**
 * Every answer the learner has recorded, newest first: listen again, open its feedback, and see at
 * the top how the overall score and each skill are moving.
 */
import { useEffect, useMemo, useState } from 'react';
import { t, uiLanguage } from '../i18n/index.ts';
import {
  getSession,
  listQuestions,
  listSessions,
  type SessionSummary,
  type SpeakingQuestion,
  type SpeakingSessionDetail,
} from './api.ts';
import { overallSeries, skillTrend, type Point, type Skill } from './progress.ts';
import { Recording } from './Recording.tsx';
import styles from './ArchiveScreen.module.css';
import { BackButton } from '../ui/BackButton.tsx';

interface Props {
  onOpen: (session: SpeakingSessionDetail, question: SpeakingQuestion, all: SpeakingQuestion[]) => void;
  onBack: () => void;
}

const SKILLS: Skill[] = ['pronunciation', 'fluency', 'vocabulary', 'grammar', 'coherence'];
const skillName = (s: Skill) =>
  ({
    pronunciation: t.speakingSkillPronunciation,
    fluency: t.speakingSkillFluency,
    vocabulary: t.speakingSkillVocabulary,
    grammar: t.speakingSkillGrammar,
    coherence: t.speakingSkillCoherence,
  })[s];

export function ArchiveScreen({ onOpen, onBack }: Props) {
  const [attempts, setAttempts] = useState<SessionSummary[] | null>(null);
  const [questions, setQuestions] = useState<SpeakingQuestion[]>([]);
  const [error, setError] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listSessions(), listQuestions()])
      .then(([sessions, qs]) => {
        if (cancelled) return;
        setAttempts(sessions);
        setQuestions(qs);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const byId = useMemo(() => new Map(questions.map((q) => [q.id, q])), [questions]);
  const series = useMemo(() => overallSeries(attempts ?? []), [attempts]);

  async function open(a: SessionSummary) {
    const question = byId.get(a.question_id);
    if (!question) return;
    setOpening(a.id);
    try {
      onOpen(await getSession(a.id), question, questions);
    } catch {
      setOpening(null);
    }
  }

  return (
    <main className={styles.screen}>
      <BackButton onClick={onBack} />
      <h1 className={styles.title}>{t.speakingArchive}</h1>

      {error && (
        <p role="alert" className={styles.note}>
          {t.speakingLoadError}
        </p>
      )}
      {attempts?.length === 0 && <p className={styles.note}>{t.speakingArchiveEmpty}</p>}

      {series.length > 0 && attempts && (
        <section className={styles.sheet} aria-labelledby="sp-progress">
          <h2 id="sp-progress" className={styles.heading}>
            {t.speakingProgress}
          </h2>
          {series.length >= 2 ? <Chart points={series} /> : <p className={styles.note}>{t.speakingProgressNeedMore}</p>}
          <ul className={styles.skills}>
            {SKILLS.map((skill) => {
              const trend = skillTrend(attempts, skill);
              if (!trend) return null;
              return (
                <li key={skill} className={styles.skill}>
                  <span>{skillName(skill)}</span>
                  <strong className={tone(trend.now)}>{trend.now}%</strong>
                  {trend.change !== null && trend.change !== 0 ? (
                    <span
                      className={trend.change > 0 ? styles.up : styles.down}
                      aria-label={trend.change > 0 ? t.speakingRose(trend.change) : t.speakingFell(-trend.change)}
                    >
                      {trend.change > 0 ? `▲ ${trend.change}` : `▼ ${-trend.change}`}
                    </span>
                  ) : (
                    <span aria-hidden="true" />
                  )}
                </li>
              );
            })}
          </ul>
          {series.length >= 2 && <p className={styles.caption}>{t.speakingProgressNote}</p>}
        </section>
      )}

      {attempts && attempts.length > 0 && (
        <ul className={styles.list} aria-label={t.speakingArchive}>
          {attempts.map((a) => {
            const q = byId.get(a.question_id);
            const text = q
              ? q.exercise_type === 'pronunciation' && q.reference_text
                ? `«${q.reference_text}»`
                : q.text
              : '';
            return (
              <li key={a.id} className={styles.item}>
                <button
                  type="button"
                  className={styles.open}
                  onClick={() => void open(a)}
                  disabled={a.status !== 'done' || !q || opening === a.id}
                >
                  <span className={styles.when}>{when(a.started_at)}</span>
                  <span className={styles.question}>{text}</span>
                  <span
                    className={`${styles.score} ${a.overall_score !== null ? tone(a.overall_score) : styles.muted}`}
                  >
                    {a.status === 'done'
                      ? a.overall_score !== null
                        ? `${Math.round(a.overall_score)}%`
                        : '—'
                      : a.status === 'failed'
                        ? t.speakingStatusFailed
                        : t.speakingStatusProcessing}
                  </span>
                </button>
                {a.has_audio && (
                  <Recording sessionId={a.id} durationMs={a.duration_ms} label={t.speakingYourRecording} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

function tone(score: number): string {
  if (score >= 75) return styles.good;
  if (score >= 50) return styles.mid;
  return styles.low;
}

function when(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(uiLanguage, { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString(uiLanguage, {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

const W = 320;
const H = 132;
const PAD = { left: 30, right: 10, top: 12, bottom: 12 };

/** The overall score per answer, oldest to newest. Tapping (or hovering) a point names it below. */
function Chart({ points }: { points: Point[] }) {
  const [picked, setPicked] = useState(points.length - 1);
  const x = (i: number) => PAD.left + (i * (W - PAD.left - PAD.right)) / (points.length - 1);
  const y = (score: number) => PAD.top + ((100 - score) * (H - PAD.top - PAD.bottom)) / 100;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ');
  const shown = points[Math.min(picked, points.length - 1)];
  const first = Math.round(points[0].score);
  const last = Math.round(points[points.length - 1].score);

  return (
    <figure className={styles.chart}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t.speakingProgressChart(points.length, first, last)}>
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line className={styles.grid} x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
            <text className={styles.axis} x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        <path className={styles.line} d={line} />
        {points.map((p, i) => (
          <g key={p.id} onMouseEnter={() => setPicked(i)} onClick={() => setPicked(i)}>
            <circle className={styles.hit} cx={x(i)} cy={y(p.score)} r={14} />
            <circle
              className={i === picked ? styles.dotPicked : styles.dot}
              cx={x(i)}
              cy={y(p.score)}
              r={i === picked ? 5 : 4}
            />
          </g>
        ))}
      </svg>
      <figcaption className={styles.readout} aria-live="polite">
        {when(shown.at)} · <strong>{Math.round(shown.score)}%</strong>
      </figcaption>
    </figure>
  );
}
