/**
 * One shadowing exercise, on one screen: listen → shadow (speak along while it plays) → compare.
 *
 * The text is shown sentence by sentence; the sentence being spoken is highlighted, and tapping a
 * sentence plays from there. The controls sit in a bar at the bottom of the screen's own area, so
 * the app's tab bar never covers them.
 *
 * Things that must hold (each was a bug):
 * - Phones only let a tap start sound. The original is unlocked inside the tap that starts
 *   shadowing, before the microphone prompt, so it can play once recording begins.
 * - If the original still cannot play, the recording is dropped and the learner is told.
 * - Cancel stops the microphone (the recorder ignores a reset while recording).
 * - An attempt exists on the server only once it is saved: cancelling or retrying leaves nothing.
 * - One sound at a time (oneAtATime); lengths come from what is known when a file has none.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { t } from '../i18n/index.ts';
import { isAudioRecordingSupported } from '../speaking/audio/AudioRecorder.ts';
import { useAudioRecorder } from '../speaking/audio/useAudioRecorder.ts';
import type { AttemptListItem, ShadowingExercise } from './api.ts';
import { getAttemptAudioUrl, getExerciseAudioUrl, listMyAttempts, saveAttempt } from './api.ts';
import { AudioPlayer, PauseIcon, PlayIcon } from './AudioPlayer.tsx';
import { claimPlayback, clock, mediaDuration, releasePlayback } from './oneAtATime.ts';
import styles from './ShadowingPlayerScreen.module.css';

interface Props {
  exercise: ShadowingExercise;
  onBack: () => void;
}

type Phase = 'listen' | 'starting' | 'recording' | 'review';
/** Normal speed, or slower for a first go. */
type Speed = 1 | 0.75;

function difficultyLabel(d: ShadowingExercise['difficulty']): string {
  if (d === 'beginner') return t.shadowingDifficultyBeginner;
  if (d === 'intermediate') return t.shadowingDifficultyIntermediate;
  return t.shadowingDifficultyAdvanced;
}

function when(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export function ShadowingPlayerScreen({ exercise, onBack }: Props) {
  const supported = isAudioRecordingSupported();
  const audioSrc = getExerciseAudioUrl(exercise.id);
  const original = useRef<HTMLAudioElement>(null);
  const [phase, setPhase] = useState<Phase>('listen');
  const phaseRef = useRef<Phase>('listen');
  const go = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);
  const [length, setLength] = useState(exercise.duration_ms / 1000);
  const [speed, setSpeed] = useState<Speed>(1);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const discard = useRef(false);

  const recorder = useAudioRecorder({ maxDurationMs: Math.ceil(exercise.duration_ms / 0.75) + 5_000 });
  // The hook's object is new on every render; its functions are stable.
  const { stop: stopRecorder, reset: resetRecorder } = recorder;

  // ── The original ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = original.current;
    if (!el) return;
    const onPlay = () => {
      claimPlayback(el);
      setPlaying(true);
    };
    const onPause = () => setPlaying(false);
    const onTime = () => setNow(el.currentTime);
    const onLength = () => setLength(mediaDuration(el, exercise.duration_ms));
    const onEnded = () => {
      setPlaying(false);
      // Shadowing ends with the original.
      if (phaseRef.current === 'recording') stopRecorder();
    };
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onLength);
    el.addEventListener('durationchange', onLength);
    el.addEventListener('ended', onEnded);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onLength);
      el.removeEventListener('durationchange', onLength);
      el.removeEventListener('ended', onEnded);
      el.pause();
      releasePlayback(el);
    };
  }, [exercise.duration_ms, stopRecorder]);

  useEffect(() => {
    if (original.current) original.current.playbackRate = speed;
  }, [speed]);

  const toggle = () => {
    const el = original.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => setError(t.shadowingAudioError));
    else el.pause();
  };

  const playFrom = (seconds: number) => {
    const el = original.current;
    if (!el || phaseRef.current !== 'listen') return;
    el.currentTime = seconds;
    setNow(seconds);
    el.play().catch(() => setError(t.shadowingAudioError));
  };

  // ── Sentences: the one being spoken is highlighted and kept in view ────────────────
  const nowMs = now * 1000;
  const current =
    now > 0 || playing ? exercise.sentences.findIndex((s) => nowMs >= s.start_ms && nowMs < s.end_ms) : -1;
  const sentenceRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (current >= 0 && (playing || phase === 'recording')) {
      sentenceRefs.current[current]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [current, playing, phase]);

  // ── Shadowing ───────────────────────────────────────────────────────────────────
  const startShadowing = async () => {
    const el = original.current;
    if (!el) return;
    setError(null);
    setSavedNote(false);
    el.pause();
    el.currentTime = 0;
    el.playbackRate = speed;
    // Unlock sound inside this tap: after the microphone prompt it would no longer count as one.
    el.muted = true;
    const unlocked = el.play().then(
      () => el.pause(),
      () => undefined,
    );
    go('starting');

    await recorder.requestPermission();
    await unlocked;
    el.muted = false;
    el.currentTime = 0;
    const ok = ['ready', 'stopped', 'recording_interrupted'];
    if (!ok.includes(recorder.current())) {
      setError(recorder.current() === 'permission_denied' ? t.shadowingPermissionDenied : t.shadowingUnsupported);
      go('listen');
      return;
    }
    await recorder.start();
    if (recorder.current() !== 'recording') {
      setError(t.shadowingUnsupported);
      go('listen');
      return;
    }
    go('recording');
    try {
      await el.play();
    } catch {
      // The learner would speak along with silence: drop the recording and say why.
      discard.current = true;
      recorder.stop();
      setError(t.shadowingAudioError);
    }
  };

  const stopShadowing = () => {
    original.current?.pause();
    recorder.stop();
  };

  const cancelShadowing = () => {
    discard.current = true;
    const el = original.current;
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
    recorder.stop();
  };

  // The recorder hands over its recording once it has stopped (or the app went to the background).
  useEffect(() => {
    if (phaseRef.current !== 'recording') return;
    if (recorder.state !== 'stopped' && recorder.state !== 'recording_interrupted') return;
    original.current?.pause();
    if (discard.current) {
      discard.current = false;
      resetRecorder();
      if (original.current) original.current.currentTime = 0;
      setNow(0);
      go('listen');
      return;
    }
    go('review');
  }, [recorder.state, resetRecorder]);

  const recordingUrl = useMemo(
    () => (recorder.recording ? URL.createObjectURL(recorder.recording.blob) : null),
    [recorder.recording],
  );
  useEffect(() => () => void (recordingUrl && URL.revokeObjectURL(recordingUrl)), [recordingUrl]);

  const tryAgain = () => {
    setError(null);
    resetRecorder();
    if (original.current) original.current.currentTime = 0;
    setNow(0);
    go('listen');
  };

  // ── Saved attempts ──────────────────────────────────────────────────────────────
  const [attempts, setAttempts] = useState<AttemptListItem[]>([]);
  const refreshAttempts = useCallback(() => {
    listMyAttempts(exercise.id)
      .then((list) => setAttempts(list.filter((a) => a.completed_at !== null && a.has_audio)))
      .catch(() => {});
  }, [exercise.id]);
  useEffect(refreshAttempts, [refreshAttempts]);

  const save = async () => {
    const rec = recorder.recording;
    if (!rec) return;
    setSaving(true);
    setError(null);
    try {
      await saveAttempt(exercise.id, rec);
      setSavedNote(true);
      refreshAttempts();
      tryAgain();
    } catch {
      setError(t.shadowingSaveError);
    } finally {
      setSaving(false);
    }
  };

  // Old attempts play with one tap: fetched once, kept, released when the screen goes.
  const [openAttempt, setOpenAttempt] = useState<string | null>(null);
  const [attemptUrls, setAttemptUrls] = useState<Record<string, string>>({});
  const [loadingAttempt, setLoadingAttempt] = useState<string | null>(null);
  const urlsRef = useRef<string[]>([]);
  useEffect(() => () => urlsRef.current.forEach((u) => URL.revokeObjectURL(u)), []);
  const openOld = async (attempt: AttemptListItem) => {
    if (openAttempt === attempt.id) {
      setOpenAttempt(null);
      return;
    }
    original.current?.pause();
    if (!attemptUrls[attempt.id]) {
      setLoadingAttempt(attempt.id);
      try {
        const url = await getAttemptAudioUrl(attempt.id);
        urlsRef.current.push(url);
        setAttemptUrls((prev) => ({ ...prev, [attempt.id]: url }));
      } catch {
        setError(t.shadowingAudioError);
        return;
      } finally {
        setLoadingAttempt(null);
      }
    }
    setOpenAttempt(attempt.id);
  };

  // ── Layout ──────────────────────────────────────────────────────────────────────
  const busy = phase === 'starting' || phase === 'recording';
  const progress = length ? Math.min(100, (now / length) * 100) : 0;
  const meta = [difficultyLabel(exercise.difficulty), clock(exercise.duration_ms / 1000), exercise.speaker]
    .filter(Boolean)
    .join(' · ');

  return (
    <main className={styles.screen}>
      <audio ref={original} src={audioSrc} preload="auto" />

      <div className={styles.scroll}>
        <div className={styles.column}>
          <button type="button" className={styles.back} onClick={onBack} disabled={busy}>
            ‹ {t.shadowingBack}
          </button>
          <h1 className={styles.title}>{exercise.title}</h1>
          <p className={styles.meta}>{meta}</p>

          <div className={styles.sheet} data-phase={phase}>
            {exercise.sentences.length > 0 ? (
              exercise.sentences.map((s, i) => (
                <button
                  key={s.start_ms}
                  ref={(el) => {
                    sentenceRefs.current[i] = el;
                  }}
                  type="button"
                  lang="en"
                  className={styles.sentence}
                  aria-current={i === current ? 'true' : undefined}
                  onClick={() => playFrom(s.start_ms / 1000)}
                  disabled={phase !== 'listen' || !exercise.has_audio}
                >
                  {s.text}
                </button>
              ))
            ) : (
              <p className={styles.plain} lang="en">
                {exercise.transcript}
              </p>
            )}
          </div>

          {attempts.length > 0 && phase !== 'recording' && (
            <section className={styles.history} aria-labelledby="sh-history">
              <h2 id="sh-history" className={styles.historyTitle}>
                {t.shadowingHistoryHeading}
              </h2>
              <ul className={styles.attempts}>
                {attempts.map((a, i) => {
                  const n = attempts.length - i;
                  const open = openAttempt === a.id && attemptUrls[a.id];
                  return (
                    <li key={a.id} className={styles.attempt}>
                      {open ? (
                        <AudioPlayer
                          key={a.id}
                          src={attemptUrls[a.id]}
                          label={`${t.shadowingAttempt(n)} · ${when(a.created_at)}`}
                          knownDurationMs={a.duration_ms ?? undefined}
                          autoPlay
                        />
                      ) : (
                        <button
                          type="button"
                          className={styles.attemptRow}
                          onClick={() => void openOld(a)}
                          disabled={loadingAttempt !== null}
                        >
                          <span className={styles.attemptPlay} aria-hidden="true">
                            <PlayIcon />
                          </span>
                          <span className={styles.attemptName}>{t.shadowingAttempt(n)}</span>
                          <span className={styles.attemptMeta}>
                            {loadingAttempt === a.id
                              ? '…'
                              : `${when(a.created_at)}${a.duration_ms ? ` · ${clock(a.duration_ms / 1000)}` : ''}`}
                          </span>
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </div>

      <footer className={styles.dock}>
        <div className={styles.column}>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          {!supported && phase === 'listen' && <p className={styles.note}>{t.shadowingUnsupported}</p>}
          {!exercise.has_audio && <p className={styles.note}>{t.shadowingAudioNotAvailable}</p>}

          {phase === 'review' && recorder.recording && recordingUrl ? (
            <>
              <div className={styles.compare}>
                <AudioPlayer src={audioSrc} label={t.shadowingOriginalLabel} knownDurationMs={exercise.duration_ms} />
                <AudioPlayer
                  key={recordingUrl}
                  src={recordingUrl}
                  label={t.shadowingYourRecordingLabel}
                  knownDurationMs={recorder.recording.durationMs}
                />
              </div>
              <div className={styles.actions}>
                {error === t.shadowingSaveError ? (
                  <button type="button" className={styles.secondary} onClick={tryAgain}>
                    {t.shadowingSkipBtn}
                  </button>
                ) : (
                  <button type="button" className={styles.secondary} onClick={tryAgain} disabled={saving}>
                    {t.shadowingRetryBtn}
                  </button>
                )}
                <button type="button" className={styles.primary} onClick={() => void save()} disabled={saving}>
                  {saving ? t.shadowingSavingLabel : t.shadowingFinishBtn}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={styles.transport}>
                {phase === 'recording' ? (
                  <span className={styles.rec} role="status">
                    <span className={styles.recDot} aria-hidden="true" />
                    {t.shadowingRecordingLabel}{' '}
                    <span className={styles.recTime}>{clock(recorder.durationMs / 1000)}</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    className={styles.playBig}
                    onClick={toggle}
                    disabled={!exercise.has_audio || phase === 'starting'}
                    aria-label={playing ? t.shadowingPause : t.shadowingPlay}
                  >
                    {playing ? <PauseIcon /> : <PlayIcon />}
                  </button>
                )}
                <div className={styles.track} aria-hidden="true">
                  <div className={styles.trackFill} style={{ '--progress': `${progress}%` } as CSSProperties} />
                </div>
                <span className={styles.time}>
                  {clock(now)} / {clock(length)}
                </span>
                {phase !== 'recording' && (
                  <button
                    type="button"
                    className={styles.speed}
                    onClick={() => setSpeed(speed === 1 ? 0.75 : 1)}
                    disabled={phase === 'starting'}
                    aria-label={`${t.shadowingSpeed}: ${speed}×`}
                  >
                    {speed}×
                  </button>
                )}
              </div>

              {phase === 'recording' ? (
                <div className={styles.actions}>
                  <button type="button" className={styles.secondary} onClick={cancelShadowing}>
                    {t.shadowingCancelBtn}
                  </button>
                  <button type="button" className={styles.stop} onClick={stopShadowing}>
                    {t.shadowingStopBtn}
                  </button>
                </div>
              ) : (
                <>
                  {savedNote && (
                    <p className={styles.saved} role="status">
                      {t.shadowingSaved}
                    </p>
                  )}
                  {attempts.length === 0 && !savedNote && <p className={styles.note}>{t.shadowingHeadphonesHint}</p>}
                  <button
                    type="button"
                    className={styles.primary}
                    onClick={() => void startShadowing()}
                    disabled={!exercise.has_audio || !supported || phase === 'starting'}
                  >
                    {t.shadowingShadowBtn}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </footer>
    </main>
  );
}
