/**
 * Shadowing one sentence at a time (ADR 0098), made for children first: hear a sentence (the video
 * pauses by itself), say it («Твоя очередь»), then hear both. One big button does the next step.
 * The video is paused while the learner speaks, so its sound is never recorded over their voice
 * and no headphones are needed.
 *
 * «Вместе с видео» is classic shadowing: the whole part plays while the learner speaks along.
 *
 * Recordings stay on this device: nothing of a child's voice is sent. Finishing records that the
 * exercise was done, which ticks a group's task linking it (ADR 0096).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n/index.ts';
import { isAudioRecordingSupported } from '../speaking/audio/AudioRecorder.ts';
import { useAudioRecorder } from '../speaking/audio/useAudioRecorder.ts';
import { BackButton } from '../ui/BackButton.tsx';
import { completeAttempt, createAttempt, getExerciseAudioUrl, type ShadowingExercise } from './api.ts';
import { PauseIcon, PlayIcon } from './AudioPlayer.tsx';
import { GiveExercise } from './GiveExercise.tsx';
import { audioPlayer } from './youtube/audioPlayer.ts';
import type { VideoPlayer } from './youtube/player.ts';
import { useYouTube } from './youtube/useYouTube.ts';
import styles from './SentencePractice.module.css';

interface Props {
  exercise: ShadowingExercise;
  onBack: () => void;
  /** A curated exercise's speak-along screen (with saved recordings), instead of the mode here. */
  onTogether?: () => void;
}

type Mode = 'sentences' | 'together';
type Phase = 'ready' | 'listening' | 'turn' | 'starting' | 'recording' | 'compare' | 'finished';

/** Time to say a sentence back: slower than the original, plus a breath. */
const turnMs = (ms: number) => Math.round(ms * 1.6 + 1500);

export function SentencePractice({ exercise, onBack, onTogether }: Props) {
  const sentences = exercise.sentences;
  const youtube = exercise.source === 'youtube' && exercise.youtube_id ? exercise.youtube_id : null;
  const { ref: frameRef, player: ytPlayer, problem: ytProblem } = useYouTube(youtube);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [fileReady, setFileReady] = useState<VideoPlayer | null>(null);
  useEffect(() => {
    if (youtube || !audioRef.current) return;
    const made = audioPlayer(audioRef.current);
    setFileReady(made);
    return () => made.destroy();
  }, [youtube]);
  const player = youtube ? ytPlayer : fileReady;

  const clipStart = exercise.clip_start_ms ?? sentences[0]?.start_ms ?? 0;
  const clipEnd = exercise.clip_end_ms ?? sentences.at(-1)?.end_ms ?? exercise.duration_ms;
  const canRecord = isAudioRecordingSupported();
  const recorder = useAudioRecorder({ maxDurationMs: Math.ceil((clipEnd - clipStart) / 0.75) + 5_000 });
  const { stop: stopRecorder, reset: resetRecorder } = recorder;

  const [mode, setMode] = useState<Mode>('sentences');
  const [index, setIndex] = useState(0);
  const [chosenPhase, setPhaseState] = useState<Phase>('ready');
  const phaseRef = useRef<Phase>('ready');
  const setPhase = (p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };
  // The recorder may stop by itself (its time limit, the app sent to the background).
  const phase: Phase =
    chosenPhase === 'recording' && (recorder.state === 'stopped' || recorder.state === 'recording_interrupted')
      ? 'compare'
      : chosenPhase;
  const [slow, setSlow] = useState(false);
  const [said, setSaid] = useState<Set<number>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const autoStop = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rate = slow ? 0.75 : 1;

  // Where the playing video is, to light up the words as they are said.
  const playingNow = phase === 'listening' || (mode === 'together' && phase === 'recording');
  useEffect(() => {
    if (!playingNow || !player) return;
    const timer = setInterval(() => setNow(player.now()), 100);
    return () => clearInterval(timer);
  }, [playingNow, player]);
  const heardAt = playingNow ? now : null;
  // In «Вместе», the sentence on screen follows the video.
  const following =
    mode === 'together' && heardAt !== null
      ? sentences.findIndex((s) => heardAt >= s.start_ms && heardAt < s.end_ms)
      : -1;
  const shown = following === -1 ? index : following;
  const sentence = sentences[shown];

  const clearAutoStop = () => {
    if (autoStop.current) clearTimeout(autoStop.current);
    autoStop.current = null;
  };

  const stopAll = useCallback(() => {
    clearAutoStop();
    player?.pause();
    if (phaseRef.current === 'recording') stopRecorder();
  }, [player, stopRecorder]);
  useEffect(() => () => clearAutoStop(), []);

  const goTo = (to: number) => {
    stopAll();
    resetRecorder();
    setError(null);
    setIndex(Math.max(0, Math.min(sentences.length - 1, to)));
    setPhase('ready');
  };

  const listen = () => {
    if (!player || !sentence) return;
    setError(null);
    setPhase('listening');
    void player.playSegment(sentence.start_ms, sentence.end_ms, rate).then((how) => {
      if (phaseRef.current !== 'listening') return;
      setPhase(how === 'ended' && canRecord ? 'turn' : how === 'ended' ? 'compare' : 'ready');
    });
  };

  /** Asks for the microphone and starts recording; false (and says why) when it can't. */
  const startRecording = async (): Promise<boolean> => {
    setError(null);
    resetRecorder();
    setPhase('starting');
    await recorder.requestPermission();
    if (!['ready', 'stopped', 'recording_interrupted'].includes(recorder.current())) {
      setError(recorder.current() === 'permission_denied' ? t.shadowingPermissionDenied : t.shadowingUnsupported);
      setPhase('ready');
      return false;
    }
    await recorder.start();
    if (recorder.current() !== 'recording') {
      setError(t.shadowingUnsupported);
      setPhase('ready');
      return false;
    }
    setPhase('recording');
    return true;
  };

  const yourTurn = async () => {
    if (!sentence || !(await startRecording())) return;
    setSaid((was) => new Set(was).add(index));
    autoStop.current = setTimeout(endRecording, turnMs((sentence.end_ms - sentence.start_ms) / rate));
  };

  const together = async () => {
    if (!player || !(await startRecording())) return;
    setSaid((was) => new Set(was).add(-1));
    void player.playSegment(clipStart, clipEnd, rate).then((how) => {
      if (how === 'ended' && phaseRef.current === 'recording') endRecording();
    });
  };

  // The recorder hands over its recording once it has stopped.
  /** Stops recording and shows both to compare. */
  const endRecording = () => {
    clearAutoStop();
    player?.pause();
    stopRecorder();
    setPhase('compare');
  };

  const original = () => {
    if (!player) return;
    recorder.pausePlayback();
    if (mode === 'together') void player.playSegment(clipStart, clipEnd, rate);
    else if (sentence) void player.playSegment(sentence.start_ms, sentence.end_ms, rate);
  };
  const mine = () => {
    player?.pause();
    void recorder.play();
  };

  const recorded = useRef(false);
  const finish = () => {
    stopAll();
    setPhase('finished');
    // Done once something was said; it ticks a group's task linking this exercise.
    if (said.size > 0 && !recorded.current) {
      recorded.current = true;
      void createAttempt(exercise.id)
        .then((attempt) => completeAttempt(attempt.id))
        .catch(() => {
          recorded.current = false;
        });
    }
  };

  const next = () => (index + 1 < sentences.length ? goTo(index + 1) : finish());

  const changeMode = (to: Mode) => {
    if (to === 'together' && onTogether) {
      onTogether();
      return;
    }
    stopAll();
    resetRecorder();
    setError(null);
    setMode(to);
    setIndex(0);
    setPhase('ready');
  };

  // The one big button: what to do now.
  type Main = 'listen' | 'pause' | 'turn' | 'stop' | 'next' | 'finish' | 'start';
  const mainKind: Main =
    mode === 'together'
      ? phase === 'recording'
        ? 'stop'
        : phase === 'compare'
          ? 'finish'
          : 'start'
      : phase === 'listening'
        ? 'pause'
        : phase === 'turn' || phase === 'starting'
          ? 'turn'
          : phase === 'recording'
            ? 'stop'
            : phase === 'compare'
              ? index + 1 < sentences.length
                ? 'next'
                : 'finish'
              : 'listen';
  const MAIN_LABEL: Record<Main, string> = {
    listen: t.spListen,
    pause: t.shadowingPause,
    turn: t.spYourTurn,
    stop: t.shadowingStopBtn,
    next: t.spNext,
    finish: t.spFinish,
    start: t.spStart,
  };
  const runMain = () => {
    if (mainKind === 'listen') listen();
    else if (mainKind === 'pause') goTo(index);
    else if (mainKind === 'turn') void yourTurn();
    else if (mainKind === 'stop') endRecording();
    else if (mainKind === 'next') next();
    else if (mainKind === 'finish') finish();
    else void together();
  };
  const mainBusy = phase === 'starting';
  const needsMic = mainKind === 'turn' || mainKind === 'start';

  // A keyboard: Space does the next step, ← → move between sentences.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as Element).closest('input, textarea, select, button, [role="dialog"]')) return;
      if (mode !== 'sentences' || phase === 'finished') return;
      if (event.key === ' ') {
        event.preventDefault();
        runMain();
      } else if (event.key === 'ArrowRight') goTo(index + 1);
      else if (event.key === 'ArrowLeft') goTo(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The words said so far in the sentence being heard.
  const words = useMemo(() => (sentence ? sentence.text.split(' ') : []), [sentence]);
  const spoken =
    heardAt !== null && sentence && heardAt >= sentence.start_ms
      ? Math.min(
          words.length,
          Math.ceil(((heardAt - sentence.start_ms) / Math.max(1, sentence.end_ms - sentence.start_ms)) * words.length),
        )
      : phase === 'turn' || phase === 'recording' || phase === 'compare'
        ? words.length
        : 0;

  const problem = youtube ? ytProblem : null;
  const loading = !player && !problem;

  if (phase === 'finished') {
    const count = said.has(-1) ? sentences.length : said.size;
    return (
      <main className={styles.screen}>
        <section className={styles.finished} aria-labelledby="sp-done">
          <h1 id="sp-done" className={styles.doneTitle}>
            {t.spDone}
          </h1>
          <p className={styles.doneText}>{t.spDoneText(count)}</p>
          <button
            type="button"
            className={styles.main}
            onClick={() => {
              setSaid(new Set());
              goTo(0);
            }}
          >
            {t.shadowingRetryBtn}
          </button>
          <button type="button" className={styles.textButton} onClick={onBack}>
            {t.spToList}
          </button>
        </section>
      </main>
    );
  }

  const step = phase === 'compare' ? 3 : phase === 'turn' || phase === 'starting' || phase === 'recording' ? 2 : 1;

  return (
    <main className={styles.screen} data-mode={mode}>
      <header className={styles.header}>
        <BackButton onClick={onBack} />
        <h1 className={styles.title}>{exercise.title}</h1>
        <GiveExercise exercise={exercise} />
      </header>

      <div className={styles.modes} role="group" aria-label={t.spMode}>
        {(['sentences', 'together'] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={styles.modeButton}
            aria-pressed={mode === m}
            onClick={() => changeMode(m)}
          >
            {m === 'sentences' ? t.spModeSentences : t.spModeTogether}
          </button>
        ))}
      </div>

      {/* The video and the sentence; beside them on a wide screen, the steps and buttons. */}
      <div className={styles.stage}>
        {youtube ? (
          <div className={styles.frame} ref={frameRef} />
        ) : (
          <audio ref={audioRef} src={getExerciseAudioUrl(exercise.id)} preload="auto" />
        )}

        {mode === 'sentences' && (
          <ol className={styles.dots} aria-label={t.ytSentences}>
            {sentences.map((s, i) => (
              <li key={`${s.start_ms}-${i}`}>
                <button
                  type="button"
                  className={styles.dot}
                  data-current={i === index || undefined}
                  data-said={said.has(i) || undefined}
                  aria-label={t.spSentence(i + 1, sentences.length)}
                  aria-current={i === index ? 'step' : undefined}
                  onClick={() => goTo(i)}
                />
              </li>
            ))}
          </ol>
        )}

        <section className={styles.card} aria-live="polite" aria-label={t.spSentence(shown + 1, sentences.length)}>
          {mode === 'sentences' && <p className={styles.eyebrow}>{t.spSentence(index + 1, sentences.length)}</p>}
          <p className={styles.sentence} lang="en">
            {words.map((word, i) => (
              <span key={i} className={i < spoken ? styles.said : undefined}>
                {word}{' '}
              </span>
            ))}
          </p>
          {sentences[shown + 1] && (
            <p className={styles.upNext} lang="en">
              {sentences[shown + 1].text}
            </p>
          )}
        </section>
      </div>

      <div className={styles.panel}>
        {problem && (
          <p role="alert" className={styles.error}>
            {problem === 'unreachable' ? t.ytNoConnection : t.ytVideoUnavailable}
          </p>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {!canRecord && <p className={styles.note}>{t.spNoMic}</p>}
        {mode === 'together' && <p className={styles.note}>{t.shadowingHeadphonesHint}</p>}

        {mode === 'sentences' && (
          <ol className={styles.steps} aria-hidden="true">
            <li data-on={step === 1 || undefined}>1 · {t.spListen}</li>
            <li data-on={step === 2 || undefined}>2 · {t.spYourTurn}</li>
            <li data-on={step === 3 || undefined}>3 · {t.spCompare}</li>
          </ol>
        )}

        <div className={styles.controls}>
          {phase === 'compare' && (
            <div className={styles.compare}>
              <button type="button" className={styles.compareButton} onClick={original}>
                <PlayIcon /> {t.shadowingOriginalLabel}
              </button>
              {recorder.recording && (
                <button type="button" className={styles.compareButton} onClick={mine}>
                  <PlayIcon /> {t.spMe}
                </button>
              )}
              <button
                type="button"
                className={styles.compareButton}
                onClick={() => (mode === 'together' ? changeMode('together') : goTo(index))}
              >
                {t.shadowingRetryBtn}
              </button>
            </div>
          )}

          <button
            type="button"
            className={styles.main}
            data-recording={phase === 'recording' || undefined}
            disabled={loading || mainBusy || (!canRecord && needsMic)}
            aria-busy={mainBusy || loading}
            onClick={runMain}
          >
            <span className={styles.mainIcon} aria-hidden="true">
              {mainKind === 'listen' ? (
                <PlayIcon />
              ) : mainKind === 'pause' || mainKind === 'stop' ? (
                <PauseIcon />
              ) : needsMic ? (
                '●'
              ) : (
                '→'
              )}
            </span>
            {MAIN_LABEL[mainKind]}
          </button>

          <div className={styles.secondary}>
            {mode === 'sentences' && (
              <button
                type="button"
                className={styles.navButton}
                disabled={index === 0}
                aria-label={t.spPrevious}
                onClick={() => goTo(index - 1)}
              >
                ‹
              </button>
            )}
            <button type="button" className={styles.slow} aria-pressed={slow} onClick={() => setSlow((s) => !s)}>
              {t.spSlower}
            </button>
            {mode === 'sentences' && (
              <button
                type="button"
                className={styles.navButton}
                disabled={index + 1 >= sentences.length}
                aria-label={t.spFollowing}
                onClick={() => goTo(index + 1)}
              >
                ›
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
