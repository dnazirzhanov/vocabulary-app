/**
 * ShadowingPlayerScreen — Chunk 2 + 3.
 *
 * Flow:
 *   1. Load exercise audio + show transcript + past attempt history.
 *   2. User listens (AudioPlayer with speed control).
 *   3. User taps "Start shadowing": mic permission → start recorder + play audio simultaneously.
 *   4. Audio ends → recorder stops → navigate to compare screen.
 *   5. Cancel during recording: recorder reset, audio pause, stay here.
 *
 * The hidden <audio> ref is always rendered so it is available synchronously when shadowing starts.
 * AudioPlayer (listen phase) uses its own independent <audio> element for the preview.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n/index.ts';
import { isAudioRecordingSupported, type Recording } from '../speaking/audio/AudioRecorder.ts';
import { useAudioRecorder } from '../speaking/audio/useAudioRecorder.ts';
import type { AttemptListItem, ShadowingExercise } from './api.ts';
import { createAttempt, getAttemptAudioUrl, getExerciseAudioUrl, listMyAttempts } from './api.ts';
import { AudioPlayer } from './AudioPlayer.tsx';
import styles from './ShadowingPlayerScreen.module.css';

interface ShadowingPlayerScreenProps {
  exercise: ShadowingExercise;
  onCompare: (attemptId: string, recording: Recording) => void;
  onBack: () => void;
}

type Phase = 'listen' | 'requesting' | 'shadowing';

function formatMs(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString([], { day: 'numeric', month: 'short' }) +
    ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
}

export function ShadowingPlayerScreen({ exercise, onCompare, onBack }: ShadowingPlayerScreenProps) {
  const supported = isAudioRecordingSupported();
  // Always-mounted audio element for the synchronized shadowing playback.
  const audioRef = useRef<HTMLAudioElement>(null);
  const [phase, setPhase] = useState<Phase>('listen');
  const [startError, setStartError] = useState<string | null>(null);
  const attemptIdRef = useRef<string | null>(null);

  // Attempt history: map of attemptId → blob URL (loaded on demand)
  const [attempts, setAttempts] = useState<AttemptListItem[]>([]);
  const [attemptUrls, setAttemptUrls] = useState<Record<string, string>>({});
  const [loadingAttemptId, setLoadingAttemptId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMyAttempts(exercise.id)
      .then((list) => {
        if (!cancelled) setAttempts(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [exercise.id]);

  // Revoke all blob URLs on unmount.
  useEffect(() => {
    const urls = attemptUrls;
    return () => {
      Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePlayAttempt = useCallback(
    async (attempt: AttemptListItem) => {
      if (loadingAttemptId) return;
      // Already loaded — toggling is handled by the AudioPlayer itself.
      if (attemptUrls[attempt.id]) return;
      setLoadingAttemptId(attempt.id);
      try {
        const url = await getAttemptAudioUrl(attempt.id);
        setAttemptUrls((prev) => ({ ...prev, [attempt.id]: url }));
      } catch {
        // silently ignore
      } finally {
        setLoadingAttemptId(null);
      }
    },
    [loadingAttemptId, attemptUrls],
  );

  const {
    durationMs,
    recording,
    error: recError,
    requestPermission,
    start,
    stop,
    reset,
  } = useAudioRecorder({ maxDurationMs: exercise.duration_ms + 5000 });

  const audioSrc = getExerciseAudioUrl(exercise.id);

  // When a recording becomes available after shadowing ended, navigate to compare.
  useEffect(() => {
    if (recording && attemptIdRef.current && phase !== 'listen') {
      onCompare(attemptIdRef.current, recording);
    }
  }, [recording, onCompare, phase]);

  const handleAudioEnded = useCallback(() => {
    stop();
    // phase will be 'shadowing'; recording will appear via the effect above
  }, [stop]);

  const handleStartShadowing = useCallback(async () => {
    setStartError(null);
    setPhase('requesting');

    try {
      await requestPermission();
    } catch {
      setStartError(t.shadowingPermissionDenied);
      setPhase('listen');
      return;
    }

    let aid: string;
    try {
      const attempt = await createAttempt(exercise.id);
      aid = attempt.id;
      attemptIdRef.current = aid;
    } catch {
      setStartError('Could not start attempt. Try again.');
      setPhase('listen');
      return;
    }

    try {
      await start();
    } catch {
      setStartError(t.shadowingPermissionDenied);
      setPhase('listen');
      return;
    }

    const el = audioRef.current;
    if (el) {
      el.currentTime = 0;
      el.playbackRate = 1.0;
      el.play().catch(() => {});
    }

    setPhase('shadowing');
  }, [exercise.id, requestPermission, start]);

  const handleCancel = useCallback(() => {
    reset();
    const el = audioRef.current;
    if (el) el.pause();
    attemptIdRef.current = null;
    setPhase('listen');
  }, [reset]);

  const hasAudio = exercise.has_audio;
  const completedAttempts = attempts.filter((a) => a.completed_at !== null);

  return (
    <main className={styles.screen}>
      {/* Hidden audio for synchronized shadowing playback — always mounted */}
      <audio ref={audioRef} src={audioSrc} onEnded={handleAudioEnded} style={{ display: 'none' }} />

      <header className={styles.header}>
        <button type="button" className={styles.back} onClick={onBack}>
          {t.shadowingBack}
        </button>
        <h1 className={styles.title}>{exercise.title}</h1>
      </header>

      <div className={styles.body}>
        {/* Difficulty + duration meta */}
        <div className={styles.meta}>
          <span className={`${styles.difficulty} ${styles[exercise.difficulty]}`}>
            {exercise.difficulty === 'beginner'
              ? t.shadowingDifficultyBeginner
              : exercise.difficulty === 'intermediate'
                ? t.shadowingDifficultyIntermediate
                : t.shadowingDifficultyAdvanced}
          </span>
          <span className={styles.duration}>
            {t.shadowingDurationLabel}: {formatMs(exercise.duration_ms)}
          </span>
        </div>

        {/* Listen player — shown while not actively recording */}
        {phase !== 'shadowing' && <AudioPlayer src={audioSrc} label={t.shadowingOriginalLabel} disabled={!hasAudio} />}

        {/* Recording indicator */}
        {phase === 'shadowing' && (
          <div className={styles.recordingPanel}>
            <div className={styles.recIndicator}>
              <span className={styles.recDot} />
              <span className={styles.recLabel}>{t.shadowingRecordingLabel}</span>
            </div>
            <span className={styles.recTime} aria-label={t.shadowingRecordingTime}>
              {formatMs(durationMs)}
            </span>
          </div>
        )}

        {phase === 'listen' && hasAudio && <p className={styles.hint}>{t.shadowingHeadphonesHint}</p>}

        {!hasAudio && <p className={styles.unavailable}>{t.shadowingAudioNotAvailable}</p>}

        {/* Transcript */}
        <section className={styles.transcriptSection}>
          <h2 className={styles.transcriptHeading}>{t.shadowingTranscriptLabel}</h2>
          <p className={styles.transcript}>{exercise.transcript}</p>
        </section>

        {/* Past attempts */}
        {completedAttempts.length > 0 && phase === 'listen' && (
          <section className={styles.historySection}>
            <h2 className={styles.historyHeading}>{t.shadowingHistoryHeading}</h2>
            <ul className={styles.attemptList}>
              {completedAttempts.map((attempt, i) => (
                <li key={attempt.id} className={styles.attemptItem}>
                  <div className={styles.attemptRow}>
                    <span className={styles.attemptNum}>
                      {t.shadowingAttemptLabel} {completedAttempts.length - i}
                    </span>
                    <span className={styles.attemptDate}>{formatDate(attempt.created_at)}</span>
                    {attempt.has_audio && !attemptUrls[attempt.id] && (
                      <button
                        type="button"
                        className={styles.playAttemptBtn}
                        onClick={() => void handlePlayAttempt(attempt)}
                        disabled={loadingAttemptId === attempt.id}
                      >
                        {loadingAttemptId === attempt.id ? '…' : t.shadowingPlayRecording}
                      </button>
                    )}
                  </div>
                  {attemptUrls[attempt.id] && (
                    <div className={styles.attemptPlayer}>
                      <AudioPlayer
                        src={attemptUrls[attempt.id]}
                        label={t.shadowingYourRecordingLabel}
                        showSpeed={false}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {(startError || recError) && (
          <p role="alert" className={styles.error}>
            {startError ??
              (recError?.code === 'permission_denied' ? t.shadowingPermissionDenied : t.shadowingUnsupported)}
          </p>
        )}

        {!supported && <p className={styles.error}>{t.shadowingUnsupported}</p>}
      </div>

      <footer className={styles.footer}>
        {phase === 'listen' && (
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={handleStartShadowing}
            disabled={!hasAudio || !supported}
          >
            {t.shadowingShadowBtn}
          </button>
        )}
        {phase === 'requesting' && (
          <button type="button" className={styles.primaryBtn} disabled>
            {t.shadowingRecordingLabel}
          </button>
        )}
        {phase === 'shadowing' && (
          <button type="button" className={styles.cancelBtn} onClick={handleCancel}>
            {t.shadowingCancelBtn}
          </button>
        )}
      </footer>
    </main>
  );
}
