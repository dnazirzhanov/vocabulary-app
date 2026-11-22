/**
 * React hook over `AudioRecorder`. Keeps the recorder alive for the component's lifetime,
 * mirrors its state into React state, and tears it down on unmount (releasing the mic).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AudioRecorder,
  type AudioRecorderOptions,
  type Recording,
  type RecorderError,
  type RecorderState,
} from './AudioRecorder.ts';

export interface UseAudioRecorderResult {
  state: RecorderState;
  durationMs: number;
  recording: Recording | null;
  error: RecorderError | null;
  requestPermission: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => void;
  /** Pause and go on recording the same answer; `canPause` says whether this browser can. */
  pause: () => void;
  resume: () => void;
  canPause: boolean;
  play: () => Promise<void>;
  pausePlayback: () => void;
  reset: () => void;
  /** The recorder's state right now: after an `await`, `state` above may not have caught up. */
  current: () => RecorderState;
}

export function useAudioRecorder(options: AudioRecorderOptions = {}): UseAudioRecorderResult {
  // Lazy init: construct the recorder once per hook mount; changing options later does NOT
  // recreate it (would require recreating the mic stream).
  const [recorder] = useState(() => new AudioRecorder(options));
  const [state, setState] = useState<RecorderState>('idle');
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState<RecorderError | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);

  useEffect(() => {
    const unsubState = recorder.subscribeState((s) => {
      setState(s);
      // Snapshot the final recording when we land in stopped/recording_interrupted.
      if (s === 'stopped' || s === 'recording_interrupted') setRecording(recorder.recording);
      if (s === 'ready' || s === 'idle') setRecording(null);
      if (s === 'ready') setDurationMs(0);
    });
    const unsubDuration = recorder.subscribeDuration((ms) => setDurationMs(ms));
    const unsubError = recorder.subscribeError((e) => setError(e));
    return () => {
      unsubState();
      unsubDuration();
      unsubError();
      recorder.destroy();
    };
  }, [recorder]);

  const requestPermission = useCallback(() => recorder.requestPermission(), [recorder]);
  const start = useCallback(() => recorder.start(), [recorder]);
  const stop = useCallback(() => recorder.stop(), [recorder]);
  const pause = useCallback(() => recorder.pause(), [recorder]);
  const resume = useCallback(() => recorder.resume(), [recorder]);
  const play = useCallback(() => recorder.play(), [recorder]);
  const pausePlayback = useCallback(() => recorder.pausePlayback(), [recorder]);
  const reset = useCallback(() => recorder.reset(), [recorder]);
  const current = useCallback(() => recorder.state, [recorder]);

  return {
    state,
    durationMs,
    recording,
    error,
    requestPermission,
    start,
    stop,
    pause,
    resume,
    canPause: recorder.canPause,
    play,
    pausePlayback,
    reset,
    current,
  };
}
