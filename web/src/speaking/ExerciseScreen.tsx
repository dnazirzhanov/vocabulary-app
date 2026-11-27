/**
 * Chunk 2 Speaking exercise screen:
 *   1. Fetch a question (first from the question bank for now).
 *   2. Record an answer via `useAudioRecorder`.
 *   3. On Submit → create a session, upload audio, show "uploaded ✓".
 *
 * No AI yet (Chunks 3-6 add it). The recording stays on the device until the learner taps
 * Submit, so Discard is always safe.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '../i18n/index.ts';
import { isAudioRecordingSupported } from './audio/AudioRecorder.ts';
import { inAppNow, reportMic } from './audio/micHelp.ts';
import { useAudioRecorder } from './audio/useAudioRecorder.ts';
import {
  createSession,
  getSession,
  listQuestions,
  uploadAudio,
  type SpeakingApiError,
  type SpeakingQuestion,
  type SpeakingSessionDetail,
} from './api.ts';
import { FeedbackList } from './FeedbackList.tsx';
import { PronunciationBreakdown } from './PronunciationBreakdown.tsx';
import { ScoreGrid } from './ScoreGrid.tsx';
import { TappableText } from '../ui/TappableText.tsx';
import styles from './ExerciseScreen.module.css';
import { BackButton } from '../ui/BackButton.tsx';

interface ExerciseScreenProps {
  question?: SpeakingQuestion | null;
  onBack: () => void;
  onDone?: (result: SpeakingSessionDetail) => void;
}

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'polling'; sessionId: string }
  | { kind: 'done'; result: SpeakingSessionDetail }
  | { kind: 'failed'; message: string };

export function ExerciseScreen({ question: questionProp, onBack, onDone }: ExerciseScreenProps) {
  const supported = isAudioRecordingSupported();
  const [question, setQuestion] = useState<SpeakingQuestion | null>(questionProp ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submit, setSubmit] = useState<SubmitState>({ kind: 'idle' });
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const { state, durationMs, recording, error, requestPermission, start, stop, pause, resume, canPause, play, reset } =
    useAudioRecorder({
      maxDurationMs: 180_000, // 3 minutes
    });
  // A microphone that can't be had is reported, with the browser (ADR 0094).
  useEffect(() => {
    if (error) reportMic('speaking', error);
  }, [error]);

  useEffect(() => {
    if (questionProp) return; // question provided by caller — no need to fetch
    let cancelled = false;
    (async () => {
      try {
        const questions = await listQuestions('spontaneous');
        if (cancelled) return;
        setQuestion(questions[0] ?? null);
      } catch (caught) {
        if (!cancelled) setLoadError(describeError(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [questionProp]);

  // Stop any in-flight poll when the component unmounts.
  useEffect(
    () => () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    },
    [],
  );

  const onSubmit = useCallback(async () => {
    if (!recording || !question) return;
    setSubmit({ kind: 'submitting' });
    try {
      const session = await createSession(question.exercise_type, question.id);
      await uploadAudio(session.id, recording.blob, recording.mimeType, recording.durationMs, null);
      setSubmit({ kind: 'polling', sessionId: session.id });
      // Poll every 2 s until done or failed.
      pollTimer.current = setInterval(async () => {
        try {
          const detail = await getSession(session.id);
          if (detail.status === 'done' || detail.status === 'failed') {
            if (pollTimer.current) clearInterval(pollTimer.current);
            if (onDone) {
              onDone(detail);
            } else {
              setSubmit({ kind: 'done', result: detail });
            }
          }
        } catch {
          // transient error — keep polling
        }
      }, 2000);
    } catch (caught) {
      setSubmit({ kind: 'failed', message: describeError(caught) });
    }
  }, [recording, question, onDone]);

  const onTryAgain = useCallback(() => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    reset();
    setSubmit({ kind: 'idle' });
  }, [reset]);

  const seconds = Math.floor(durationMs / 1000);
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  const durationLabel = `${mm}:${ss.toString().padStart(2, '0')}`;

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <BackButton onClick={onBack} />
        <h1 className={styles.title}>{t.speakingExerciseHeading}</h1>
      </header>

      {!supported && (
        <p role="alert" className={styles.error}>
          {inAppNow() ? t.micInAppBrowser : t.speakingUnsupported}
        </p>
      )}

      {supported && (
        <section className={styles.body}>
          {question?.exercise_type === 'pronunciation' && question.reference_text ? (
            <div>
              <p className={styles.questionLabel}>{t.speakingReadAloud}</p>
              <TappableText
                className={styles.referenceText}
                text={question.reference_text}
                kind="speaking"
                questionId={question.id}
              />
            </div>
          ) : question ? (
            <TappableText className={styles.question} text={question.text} kind="speaking" questionId={question.id} />
          ) : (
            <p className={styles.question}>{t.speakingLoadingQuestion}</p>
          )}
          {loadError && (
            <p role="alert" className={styles.error}>
              {loadError}
            </p>
          )}

          <div className={styles.recorder} aria-live="polite">
            <div className={styles.timer}>{durationLabel}</div>
            <div className={styles.stateLabel}>{stateLabel(state, submit.kind)}</div>

            <div className={styles.controls}>
              {(state === 'idle' || state === 'permission_denied') && (
                <button type="button" className={styles.primary} onClick={() => void requestPermission()}>
                  {t.speakingEnableMic}
                </button>
              )}

              {(state === 'ready' || state === 'stopped' || state === 'recording_interrupted' || state === 'playing') &&
                submit.kind !== 'polling' &&
                submit.kind !== 'done' && (
                  <button
                    type="button"
                    className={styles.primary}
                    onClick={() => void start()}
                    disabled={state === 'playing' || submit.kind === 'submitting'}
                  >
                    {state === 'ready' ? t.speakingStartRecording : t.speakingRecordAgain}
                  </button>
                )}

              {state === 'recording' && canPause && (
                <button type="button" className={styles.secondary} onClick={pause}>
                  {t.speakingPause}
                </button>
              )}

              {state === 'paused' && (
                <button type="button" className={styles.primary} onClick={resume}>
                  {t.speakingResume}
                </button>
              )}

              {(state === 'recording' || state === 'paused') && (
                <button
                  type="button"
                  className={state === 'recording' ? `${styles.primary} ${styles.recording}` : styles.secondary}
                  onClick={stop}
                >
                  {t.speakingStopRecording}
                </button>
              )}

              {(state === 'stopped' || state === 'recording_interrupted') && recording && (
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => void play()}
                  disabled={submit.kind === 'submitting'}
                >
                  {t.speakingPlay}
                </button>
              )}

              {state === 'playing' && (
                <button type="button" className={styles.secondary} disabled>
                  {t.speakingPlaying}
                </button>
              )}

              {(state === 'stopped' || state === 'recording_interrupted') &&
                recording &&
                submit.kind !== 'polling' &&
                submit.kind !== 'done' && (
                  <button
                    type="button"
                    className={styles.primary}
                    onClick={() => void onSubmit()}
                    disabled={!question || submit.kind === 'submitting'}
                  >
                    {submit.kind === 'submitting' ? t.speakingUploading : t.speakingSubmit}
                  </button>
                )}

              {(state === 'stopped' || state === 'recording_interrupted') &&
                submit.kind !== 'submitting' &&
                submit.kind !== 'polling' &&
                submit.kind !== 'done' && (
                  <button type="button" className={styles.tertiary} onClick={reset}>
                    {t.speakingDiscard}
                  </button>
                )}
            </div>

            {state === 'recording_interrupted' && <p className={styles.notice}>{t.speakingInterruptedNotice}</p>}
            {state === 'paused' && <p className={styles.notice}>{t.speakingPausedNotice}</p>}

            {(submit.kind === 'polling' || submit.kind === 'done') && (
              <div className={styles.submittedBox}>
                <p className={styles.submittedTitle}>{t.speakingUploaded}</p>
                <p className={styles.submittedNote}>{t.speakingAssessmentComingSoon}</p>
                {submit.kind === 'done' && (
                  <button type="button" className={styles.secondary} onClick={onTryAgain}>
                    {t.speakingTryAnother}
                  </button>
                )}
              </div>
            )}

            {submit.kind === 'failed' && (
              <p role="alert" className={styles.error}>
                {submit.message}
              </p>
            )}
          </div>

          {error && submit.kind !== 'failed' && (
            <p role="alert" className={styles.error}>
              {error.message}
            </p>
          )}

          {recording && submit.kind === 'idle' && (
            <p className={styles.meta}>
              {recording.mimeType} · {Math.round(recording.blob.size / 1024)} KB · {durationLabel}
            </p>
          )}

          {submit.kind === 'done' && submit.result.assessment && <ScoreGrid assessment={submit.result.assessment} />}

          {submit.kind === 'done' &&
            submit.result.assessment?.pronunciation_words &&
            submit.result.assessment.pronunciation_words.length > 0 && (
              <PronunciationBreakdown
                words={submit.result.assessment.pronunciation_words}
                pronunciationScore={submit.result.assessment.pronunciation_score}
              />
            )}

          {submit.kind === 'done' && submit.result.assessment?.feedback_items && (
            <FeedbackList items={submit.result.assessment.feedback_items} />
          )}
        </section>
      )}
    </main>
  );
}

function stateLabel(state: string, submitKind: SubmitState['kind']): string {
  if (submitKind === 'submitting') return t.speakingUploading;
  if (submitKind === 'polling') return t.speakingAssessmentComingSoon;
  if (submitKind === 'done') return t.speakingUploaded;
  switch (state) {
    case 'idle':
      return t.speakingStateIdle;
    case 'requesting_permission':
      return t.speakingStateRequesting;
    case 'permission_denied':
      return inAppNow() ? t.micInAppBrowser : t.speakingStatePermissionDenied;
    case 'ready':
      return t.speakingStateReady;
    case 'recording':
      return t.speakingStateRecording;
    case 'paused':
      return t.speakingStatePaused;
    case 'recording_interrupted':
      return t.speakingStateInterrupted;
    case 'stopped':
      return t.speakingStateStopped;
    case 'playing':
      return t.speakingStatePlaying;
    case 'error':
      return t.speakingStateError;
    default:
      return state;
  }
}

function describeError(caught: unknown): string {
  if (caught && typeof caught === 'object' && 'message' in caught) {
    const err = caught as SpeakingApiError;
    if (err.code === 'speaking_session_limit') return t.speakingLimitReached;
    if (err.code === 'audio_too_large') return t.speakingUploadTooLarge;
    return err.message;
  }
  return 'Upload failed. Try again.';
}
