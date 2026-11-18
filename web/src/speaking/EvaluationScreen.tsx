import { useState } from 'react';
import { t } from '../i18n/index.ts';
import { PronunciationBreakdown } from './PronunciationBreakdown.tsx';
import { FeedbackList } from './FeedbackList.tsx';
import type { SpeakingQuestion, SpeakingSessionDetail, SpeakingAssessment } from './api.ts';
import styles from './EvaluationScreen.module.css';

interface EvaluationScreenProps {
  session: SpeakingSessionDetail;
  question: SpeakingQuestion;
  onBack: () => void;
}

type SkillKey = 'pronunciation' | 'fluency' | 'vocabulary' | 'grammar' | 'coherence';

export function EvaluationScreen({ session, question, onBack }: EvaluationScreenProps) {
  const a = session.assessment;
  const [openSkill, setOpenSkill] = useState<SkillKey | null>(null);

  function toggleSkill(key: SkillKey) {
    setOpenSkill((prev) => (prev === key ? null : key));
  }

  const summary = a ? feedbackSummary(a) : null;
  const durationLabel = a ? formatDuration(a) : null;

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <button type="button" className={styles.back} onClick={onBack}>
          {t.speakingBack}
        </button>
        <h1 className={styles.title}>{t.speakingEvalHeading}</h1>
      </header>

      <div className={styles.body}>
        {/* Question */}
        <div className={styles.questionBox}>
          {question.exercise_type === 'pronunciation' && question.reference_text ? (
            <p className={styles.questionText}>"{question.reference_text}"</p>
          ) : (
            <p className={styles.questionText}>{question.text}</p>
          )}
        </div>

        {a && (
          <>
            {/* Overall card */}
            <div className={styles.overallCard}>
              <div className={styles.overallTop}>
                {a.overall_score !== null && (
                  <span className={`${styles.overallScore} ${scoreColorClass(a.overall_score)}`}>
                    {Math.round(a.overall_score)}%
                  </span>
                )}
                {durationLabel && <span className={styles.duration}>{durationLabel}</span>}
              </div>
              {summary && <p className={styles.summary}>{summary}</p>}
            </div>

            {/* Skill rows */}
            <section className={styles.skillsSection}>
              <h2 className={styles.sectionLabel}>{t.speakingEvalSkillsLabel}</h2>
              <div className={styles.skillList}>
                {SKILLS.map(({ key, label }) => {
                  const score = a[`${key}_score` as keyof SpeakingAssessment] as number | null;
                  const expl = getExplanation(key, a);
                  const isOpen = openSkill === key;
                  return (
                    <div key={key} className={styles.skillCard}>
                      <button
                        type="button"
                        className={styles.skillRow}
                        onClick={() => toggleSkill(key)}
                        aria-expanded={isOpen}
                      >
                        <span className={styles.skillName}>{label}</span>
                        <span
                          className={`${styles.skillScore} ${score === null ? styles.scoreNull : scoreColorClass(score)}`}
                        >
                          {score !== null ? `${Math.round(score)}%` : '—'}
                        </span>
                        <span className={styles.chevron}>{isOpen ? '▾' : '▸'}</span>
                      </button>

                      {isOpen && (
                        <div className={styles.skillDetail}>
                          {expl ? (
                            <p className={styles.skillExplanation}>{expl}</p>
                          ) : (
                            <p className={styles.skillExplanation}>{t.speakingEvalInsufficientData}</p>
                          )}

                          {/* Grammar errors list */}
                          {key === 'grammar' && renderGrammarDetail(a)}

                          {/* Pronunciation word breakdown */}
                          {key === 'pronunciation' && a.pronunciation_words.length > 0 && (
                            <PronunciationBreakdown
                              words={a.pronunciation_words}
                              pronunciationScore={a.pronunciation_score}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Transcript */}
            <section className={styles.section}>
              <h2 className={styles.sectionLabel}>{t.speakingEvalTranscriptLabel}</h2>
              <p className={styles.transcript}>{a.transcript}</p>
            </section>

            {/* Feedback items */}
            {a.feedback_items.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.sectionLabel}>{t.speakingEvalFeedbackLabel}</h2>
                <FeedbackList items={a.feedback_items} />
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}

const SKILLS: { key: SkillKey; label: string }[] = [
  { key: 'pronunciation', label: 'Pronunciation' },
  { key: 'fluency', label: 'Fluency' },
  { key: 'vocabulary', label: 'Vocabulary' },
  { key: 'grammar', label: 'Grammar' },
  { key: 'coherence', label: 'Coherence' },
];

function scoreColorClass(score: number): string {
  if (score >= 75) return styles.scoreGood;
  if (score >= 50) return styles.scoreMid;
  return styles.scoreLow;
}

function feedbackSummary(a: SpeakingAssessment): string | null {
  const summary = (a.evidence.feedback as Record<string, unknown> | undefined)?.summary as string | undefined;
  return summary?.trim() || null;
}

function formatDuration(a: SpeakingAssessment): string | null {
  const whisper = a.evidence.whisper as Record<string, unknown> | undefined;
  const durationS = whisper?.duration as number | undefined;
  if (!durationS) return null;
  const m = Math.floor(durationS / 60);
  const s = Math.round(durationS % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function getExplanation(key: SkillKey, a: SpeakingAssessment): string | null {
  const ev = a.evidence;
  switch (key) {
    case 'fluency': {
      const f = ev.fluency as Record<string, unknown> | undefined;
      if (!f || f.skipped) return null;
      const wpm = f.wpm as number | undefined;
      const pauses = f.pause_count as number | undefined;
      if (wpm === undefined) return null;
      const parts = [`${Math.round(wpm)} ${t.speakingEvalWpm}`];
      if (pauses !== undefined) parts.push(`${pauses} ${t.speakingEvalPauses}`);
      return parts.join(' · ');
    }
    case 'vocabulary': {
      const v = ev.vocabulary as Record<string, unknown> | undefined;
      if (!v) return null;
      if (v.skipped === 'insufficient_evidence') return t.speakingEvalVocabInsufficient;
      const dist = v.cefr_distribution as Record<string, number> | undefined;
      if (!dist) return null;
      const dominant = Object.entries(dist).sort((a, b) => b[1] - a[1])[0];
      if (!dominant || dominant[1] === 0) return null;
      return `Dominant level: ${dominant[0]}`;
    }
    case 'grammar': {
      const g = ev.grammar as Record<string, unknown> | undefined;
      if (!g) return t.speakingEvalGrammarNoService;
      if (g.skipped === 'no_url' || g.skipped === 'insufficient_evidence') {
        return g.skipped === 'insufficient_evidence' ? t.speakingEvalInsufficientData : null;
      }
      const errorCount = g.error_count as number | undefined;
      if (errorCount === undefined) return null;
      return errorCount === 0 ? t.speakingEvalNoErrors : `${errorCount} issue${errorCount === 1 ? '' : 's'} found`;
    }
    case 'coherence': {
      const c = ev.coherence as Record<string, unknown> | undefined;
      if (!c || c.skipped) return null;
      return (c.justification as string | undefined) ?? null;
    }
    case 'pronunciation': {
      const p = ev.azure_pa as Record<string, unknown> | undefined;
      if (!p || p.skipped) return null;
      const pScore = p.pronunciation_score as number | undefined;
      if (pScore === undefined) return null;
      return `Azure score: ${Math.round(pScore)}%`;
    }
  }
}

function renderGrammarDetail(a: SpeakingAssessment): React.ReactNode {
  const feedbackItems = a.feedback_items.filter((item) => item.category === 'grammar');
  if (feedbackItems.length === 0) return null;
  return (
    <ul className={styles.grammarErrors}>
      {feedbackItems.map((item, i) => (
        <li key={i} className={styles.grammarError}>
          {item.original_text && <span className={styles.grammarOriginal}>"{item.original_text}"</span>}
          {item.corrected_text && <span className={styles.grammarCorrected}>→ {item.corrected_text}</span>}
          {item.explanation && <p className={styles.grammarExplanation}>{item.explanation}</p>}
        </li>
      ))}
    </ul>
  );
}

// Need React import for JSX return type
import React from 'react';
