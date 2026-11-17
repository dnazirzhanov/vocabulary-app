/**
 * Shows word-by-word pronunciation accuracy from Azure PA (Chunk 4).
 * Each word is colour-coded by accuracy score:
 *   green  ≥ 80   good
 *   yellow 60–79  needs work
 *   red    < 60   mispronounced / missing
 *
 * Tapping a word reveals its phoneme breakdown.
 */

import { useState } from 'react';
import { t } from '../i18n/index.ts';
import type { PronunciationWord } from './api.ts';
import styles from './PronunciationBreakdown.module.css';

interface Props {
  words: PronunciationWord[];
  pronunciationScore: number | null;
}

export function PronunciationBreakdown({ words, pronunciationScore }: Props) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (words.length === 0) {
    return <p className={styles.empty}>{t.speakingNeedMoreSpeech}</p>;
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.label}>{t.speakingPronunciationResult}</span>
        {pronunciationScore !== null && (
          <span className={styles.score}>{t.speakingPronunciationScore(pronunciationScore)}</span>
        )}
      </div>

      <p className={styles.wordLabel}>{t.speakingWordAccuracy}</p>
      <div className={styles.words}>
        {words.map((w, i) => (
          <button
            key={i}
            type="button"
            className={`${styles.word} ${accuracyClass(w.accuracy_score, w.error_type)}`}
            onClick={() => setExpanded(expanded === i ? null : i)}
            aria-expanded={expanded === i}
            aria-label={`${w.word} ${Math.round(w.accuracy_score)}%`}
          >
            <span className={styles.wordText}>{w.word}</span>
            <span className={styles.wordScore}>{Math.round(w.accuracy_score)}</span>
          </button>
        ))}
      </div>

      {expanded !== null && words[expanded] && (
        <div className={styles.phonemePanel} role="region" aria-label="Phoneme breakdown">
          <p className={styles.phonemeWord}>{words[expanded].word}</p>
          {words[expanded].error_type !== 'None' && words[expanded].error_type !== '' && (
            <p className={styles.errorType}>{words[expanded].error_type}</p>
          )}
          <div className={styles.phonemes}>
            {words[expanded].phonemes.map((ph, j) => (
              <span
                key={j}
                className={`${styles.phoneme} ${accuracyClass(ph.accuracy_score, 'None')}`}
                title={`${ph.phoneme}: ${Math.round(ph.accuracy_score)}%`}
              >
                {ph.phoneme}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function accuracyClass(score: number, errorType: string): string {
  if (errorType === 'Missing') return styles.missing;
  if (score >= 80) return styles.good;
  if (score >= 60) return styles.fair;
  return styles.poor;
}
