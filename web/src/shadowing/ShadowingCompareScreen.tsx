/**
 * ShadowingCompareScreen — Chunk 4.
 *
 * Shows two independent audio players:
 *   - Original exercise recording
 *   - The learner's just-recorded blob (object URL, never touches the server for playback)
 *
 * On "Finish": uploads the audio, marks the attempt complete, then returns to the exercise list.
 * On "Try again": discards the blob (revokes object URL), returns to player for a new attempt.
 */

import { useEffect, useMemo, useState } from 'react';
import { t } from '../i18n/index.ts';
import type { Recording } from '../speaking/audio/AudioRecorder.ts';
import type { ShadowingExercise } from './api.ts';
import { completeAttempt, getExerciseAudioUrl, uploadAttemptAudio } from './api.ts';
import { AudioPlayer } from './AudioPlayer.tsx';
import styles from './ShadowingCompareScreen.module.css';

interface ShadowingCompareScreenProps {
  exercise: ShadowingExercise;
  attemptId: string;
  recording: Recording;
  onRetry: () => void;
  onFinish: () => void;
}

type SaveState = 'idle' | 'saving' | 'done' | 'error';

export function ShadowingCompareScreen({
  exercise,
  attemptId,
  recording,
  onRetry,
  onFinish,
}: ShadowingCompareScreenProps) {
  const [saveState, setSaveState] = useState<SaveState>('idle');

  // Create object URL from blob; revoke on unmount to free memory.
  const recordingUrl = useMemo(() => URL.createObjectURL(recording.blob), [recording.blob]);
  useEffect(() => () => URL.revokeObjectURL(recordingUrl), [recordingUrl]);

  const originalUrl = getExerciseAudioUrl(exercise.id);

  const handleFinish = async () => {
    setSaveState('saving');
    try {
      await uploadAttemptAudio(attemptId, recording.blob, recording.mimeType, recording.durationMs);
      await completeAttempt(attemptId);
      setSaveState('done');
      onFinish();
    } catch {
      setSaveState('error');
    }
  };

  const handleRetry = () => {
    if (saveState === 'saving') return;
    onRetry();
  };

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title}>{exercise.title}</h1>
      </header>

      <div className={styles.body}>
        <AudioPlayer
          src={originalUrl}
          label={t.shadowingOriginalLabel}
          disabled={!exercise.has_audio}
        />

        <AudioPlayer
          src={recordingUrl}
          label={t.shadowingYourRecordingLabel}
          showSpeed={false}
        />
      </div>

      <footer className={styles.footer}>
        {saveState === 'error' && (
          <p role="alert" className={styles.saveError}>
            {t.shadowingSaveError}
          </p>
        )}

        <div className={styles.actions}>
          {saveState === 'error' ? (
            <button type="button" className={styles.retryBtn} onClick={onFinish}>
              {t.shadowingSkipBtn}
            </button>
          ) : (
            <button
              type="button"
              className={styles.retryBtn}
              onClick={handleRetry}
              disabled={saveState === 'saving'}
            >
              {t.shadowingRetryBtn}
            </button>
          )}

          <button
            type="button"
            className={styles.finishBtn}
            onClick={handleFinish}
            disabled={saveState === 'saving' || saveState === 'done'}
          >
            {saveState === 'saving' ? t.shadowingSavingLabel : t.shadowingFinishBtn}
          </button>
        </div>
      </footer>
    </main>
  );
}
