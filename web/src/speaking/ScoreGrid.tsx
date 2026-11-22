/**
 * Shows a grid of dimension scores (overall, fluency, vocabulary, grammar, coherence).
 * A null score renders as "—" (not enough evidence).
 */

import { t } from '../i18n/index.ts';
import type { SpeakingAssessment } from './api.ts';
import styles from './ScoreGrid.module.css';

interface Props {
  assessment: SpeakingAssessment;
}

export function ScoreGrid({ assessment }: Props) {
  const dimensions: { label: string; score: number | null }[] = [
    { label: t.speakingOverallScore, score: assessment.overall_score },
    { label: t.speakingFluencyScore, score: assessment.fluency_score },
    { label: t.speakingVocabularyScore, score: assessment.vocabulary_score },
    { label: t.speakingGrammarScore, score: assessment.grammar_score },
    { label: t.speakingCoherenceScore, score: assessment.coherence_score },
  ];

  const anyScore = dimensions.some((d) => d.score !== null);
  if (!anyScore) {
    return <p className={styles.empty}>{t.speakingNeedMoreWords}</p>;
  }

  return (
    <div className={styles.grid}>
      {dimensions.map(({ label, score }) => (
        <div key={label} className={`${styles.cell} ${score !== null ? scoreClass(score) : styles.missing}`}>
          <span className={styles.cellLabel}>{label}</span>
          <span className={styles.cellScore}>{score !== null ? t.speakingScoreLabel(score) : '—'}</span>
        </div>
      ))}
    </div>
  );
}

function scoreClass(score: number): string {
  if (score >= 80) return styles.good;
  if (score >= 60) return styles.fair;
  return styles.poor;
}
