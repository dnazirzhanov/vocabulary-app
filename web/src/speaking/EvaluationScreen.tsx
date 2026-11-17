import { t } from '../i18n/index.ts';
import { PronunciationBreakdown } from './PronunciationBreakdown.tsx';
import { FeedbackList } from './FeedbackList.tsx';
import type { SpeakingQuestion, SpeakingSessionDetail } from './api.ts';
import styles from './EvaluationScreen.module.css';

interface EvaluationScreenProps {
  session: SpeakingSessionDetail;
  question: SpeakingQuestion;
  onBack: () => void;
}

export function EvaluationScreen({ session, question, onBack }: EvaluationScreenProps) {
  const a = session.assessment;

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <button type="button" className={styles.back} onClick={onBack}>
          {t.speakingBack}
        </button>
        <h1 className={styles.title}>{t.speakingEvalHeading}</h1>
      </header>

      <div className={styles.body}>
        {/* Question context */}
        <div className={styles.questionBox}>
          {question.exercise_type === 'pronunciation' && question.reference_text ? (
            <p className={styles.referenceText}>"{question.reference_text}"</p>
          ) : (
            <p className={styles.questionText}>{question.text}</p>
          )}
        </div>

        {a && (
          <>
            {/* Transcript */}
            <section className={styles.section}>
              <h2 className={styles.sectionHeading}>{t.speakingEvalTranscript}</h2>
              <p className={styles.transcript}>{a.transcript}</p>
            </section>

            {/* Score rows */}
            <section className={styles.section}>
              <h2 className={styles.sectionHeading}>{t.speakingEvalScores}</h2>
              <div className={styles.scoreList}>
                <ScoreRow
                  label={t.speakingEvalOverall}
                  score={a.overall_score}
                  highlight
                />
                <ScoreRow
                  label={t.speakingEvalFluency}
                  score={a.fluency_score}
                  explanation={fluencyExplanation(a.evidence)}
                />
                <ScoreRow
                  label={t.speakingEvalVocabulary}
                  score={a.vocabulary_score}
                  explanation={vocabularyExplanation(a.evidence, a.vocabulary_score)}
                />
                <ScoreRow
                  label={t.speakingEvalGrammar}
                  score={a.grammar_score}
                  explanation={grammarExplanation(a.evidence, a.grammar_score)}
                />
                <ScoreRow
                  label={t.speakingEvalCoherence}
                  score={a.coherence_score}
                  explanation={coherenceExplanation(a.evidence)}
                />
                {a.pronunciation_score !== null && (
                  <ScoreRow
                    label={t.speakingEvalPronunciation}
                    score={a.pronunciation_score}
                  />
                )}
              </div>
            </section>

            {/* Pronunciation word breakdown */}
            {a.pronunciation_words.length > 0 && (
              <PronunciationBreakdown
                words={a.pronunciation_words}
                pronunciationScore={a.pronunciation_score}
              />
            )}

            {/* AI feedback items */}
            {a.feedback_items.length > 0 && (
              <FeedbackList items={a.feedback_items} />
            )}
          </>
        )}
      </div>
    </main>
  );
}

interface ScoreRowProps {
  label: string;
  score: number | null;
  explanation?: string | null;
  highlight?: boolean;
}

function ScoreRow({ label, score, explanation, highlight }: ScoreRowProps) {
  return (
    <div className={`${styles.scoreRow} ${highlight ? styles.scoreRowHighlight : ''}`}>
      <div className={styles.scoreLeft}>
        <span className={styles.scoreLabel}>{label}</span>
        {explanation && <span className={styles.scoreExplanation}>{explanation}</span>}
      </div>
      <span className={`${styles.scoreValue} ${score === null ? styles.scoreNull : scoreColorClass(score)}`}>
        {score !== null ? `${Math.round(score)}%` : '—'}
      </span>
    </div>
  );
}

function scoreColorClass(score: number): string {
  if (score >= 75) return styles.scoreGood;
  if (score >= 50) return styles.scoreMid;
  return styles.scoreLow;
}

function fluencyExplanation(evidence: Record<string, unknown>): string | null {
  const f = evidence.fluency as Record<string, unknown> | undefined;
  if (!f || f.skipped) return null;
  const wpm = f.wpm as number | undefined;
  const pauses = f.pause_count as number | undefined;
  if (wpm === undefined) return null;
  const parts = [`${Math.round(wpm)} wpm`];
  if (pauses !== undefined) parts.push(`${pauses} pauses`);
  return parts.join(' · ');
}

function vocabularyExplanation(evidence: Record<string, unknown>, score: number | null): string | null {
  const v = evidence.vocabulary as Record<string, unknown> | undefined;
  if (!v) return null;
  if (v.skipped === 'insufficient_evidence') return t.speakingEvalVocabInsufficient;
  if (score === null) return null;
  const dist = v.cefr_distribution as Record<string, number> | undefined;
  if (!dist) return null;
  // Find the dominant CEFR level (highest count).
  const dominant = Object.entries(dist).sort((a, b) => b[1] - a[1])[0];
  if (!dominant || dominant[1] === 0) return null;
  return `Dominant level: ${dominant[0]}`;
}

function grammarExplanation(evidence: Record<string, unknown>, score: number | null): string | null {
  const g = evidence.grammar as Record<string, unknown> | undefined;
  if (!g) return t.speakingEvalGrammarNoService;
  if (g.skipped === 'no_url') return t.speakingEvalGrammarNoService;
  if (score === null) return null;
  const errorCount = g.error_count as number | undefined;
  if (errorCount === undefined) return null;
  return errorCount === 0 ? 'No errors found' : `${errorCount} issue${errorCount === 1 ? '' : 's'} found`;
}

function coherenceExplanation(evidence: Record<string, unknown>): string | null {
  const c = evidence.coherence as Record<string, unknown> | undefined;
  if (!c || c.skipped) return null;
  return (c.justification as string | undefined) ?? null;
}
