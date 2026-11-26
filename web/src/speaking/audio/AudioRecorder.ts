/**
 * The Speaking feature's audio recorder. A framework-independent state machine around
 * `getUserMedia` + `MediaRecorder` with explicit lifecycle states, so the rest of the app
 * never touches the browser's recording APIs directly.
 *
 * State machine:
 *   idle
 *     └─ requestPermission() ──▶ requesting_permission
 *                                   ├─ grant ──▶ ready
 *                                   └─ deny  ──▶ permission_denied
 *   ready
 *     └─ start() ──▶ recording
 *                      ├─ pause()  ──▶ paused ── resume() ──▶ recording
 *                      │                └─ stop() ──▶ stopped
 *                      ├─ stop()                        ──▶ stopped
 *                      ├─ max-duration timeout          ──▶ stopped
 *                      ├─ visibilitychange (background) ──▶ recording_interrupted
 *                      └─ fatal error                   ──▶ error
 *   stopped
 *     ├─ play()   ──▶ playing ──▶ stopped (on end)
 *     └─ reset()  ──▶ ready
 *   recording_interrupted
 *     └─ (audio kept; user can play() or reset())
 *
 * Upload / uploaded states live in Chunk 2 — this file does not know about network calls.
 */

export type RecorderState =
  | 'idle'
  | 'requesting_permission'
  | 'permission_denied'
  | 'ready'
  | 'recording'
  | 'paused'
  | 'recording_interrupted'
  | 'stopped'
  | 'playing'
  | 'error';

export type RecorderErrorCode =
  'permission_denied' | 'not_supported' | 'start_failed' | 'playback_failed' | 'stop_failed' | 'unknown';

export class RecorderError extends Error {
  readonly code: RecorderErrorCode;
  constructor(code: RecorderErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'RecorderError';
  }
}

export interface Recording {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

/** MIME types we prefer, in order. Chrome WebView and desktop Chrome accept the first. */
const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2', // Safari
  'audio/mp4',
] as const;

/** Globals the recorder needs. Injectable for tests. */
export interface RecorderGlobals {
  mediaDevices: Pick<MediaDevices, 'getUserMedia'>;
  MediaRecorderCtor: typeof MediaRecorder;
  isTypeSupported: (type: string) => boolean;
  /** Returns an HTMLAudioElement for playback. */
  createAudio: (src: string) => HTMLAudioElement;
  /** Document for visibility handling; omit in non-DOM test environments. */
  doc?: Document;
}

export interface AudioRecorderOptions {
  /** Hard-stop recording after this many ms. Default 120 000 (2 min); Speaking answers pass 180 000. */
  maxDurationMs?: number;
  /** Audio constraints for getUserMedia. Default: 16 kHz mono, EC/NS/AGC on. */
  audioConstraints?: MediaTrackConstraints;
  /** Inject non-default globals (for testing). */
  globals?: RecorderGlobals;
}

type Listener<T> = (value: T) => void;

export class AudioRecorder {
  private _state: RecorderState = 'idle';
  private _recording: Recording | null = null;
  private _lastError: RecorderError | null = null;
  private _mediaStream: MediaStream | null = null;
  private _recorder: MediaRecorder | null = null;
  private _chunks: Blob[] = [];
  private _mime = '';
  private _startedAt = 0;
  // Time recorded before the latest resume: a pause stops the clock and the 3-minute limit alike.
  private _recordedBefore = 0;
  private _durationTimer: ReturnType<typeof setInterval> | null = null;
  private _maxTimer: ReturnType<typeof setTimeout> | null = null;
  private _audio: HTMLAudioElement | null = null;
  private _blobUrl: string | null = null;

  private readonly _stateListeners = new Set<Listener<RecorderState>>();
  private readonly _durationListeners = new Set<Listener<number>>();
  private readonly _errorListeners = new Set<Listener<RecorderError>>();

  private _onVisibilityChange: (() => void) | null = null;

  private readonly maxDurationMs: number;
  private readonly audioConstraints: MediaTrackConstraints;
  private readonly globals: RecorderGlobals;

  constructor(opts: AudioRecorderOptions = {}) {
    this.maxDurationMs = opts.maxDurationMs ?? 120_000;
    this.audioConstraints = opts.audioConstraints ?? {
      channelCount: 1,
      sampleRate: 16_000,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    this.globals = opts.globals ?? defaultGlobals();
    this.installVisibilityHandler();
  }

  // ── Public accessors ──────────────────────────────────────────────────────────

  get state(): RecorderState {
    return this._state;
  }
  get recording(): Recording | null {
    return this._recording;
  }
  get lastError(): RecorderError | null {
    return this._lastError;
  }
  /** Whether this browser's recorder can pause and resume (all current ones can). */
  get canPause(): boolean {
    const proto = this.globals.MediaRecorderCtor?.prototype as Partial<MediaRecorder> | undefined;
    return typeof proto?.pause === 'function' && typeof proto?.resume === 'function';
  }

  subscribeState(l: Listener<RecorderState>): () => void {
    this._stateListeners.add(l);
    return () => this._stateListeners.delete(l);
  }
  subscribeDuration(l: Listener<number>): () => void {
    this._durationListeners.add(l);
    return () => this._durationListeners.delete(l);
  }
  subscribeError(l: Listener<RecorderError>): () => void {
    this._errorListeners.add(l);
    return () => this._errorListeners.delete(l);
  }

  // ── Transitions ───────────────────────────────────────────────────────────────

  /**
   * Request microphone access. Transitions idle → requesting_permission → ready / permission_denied.
   * Safe to call from any state; a no-op if already past permission.
   */
  async requestPermission(): Promise<void> {
    if (this._state !== 'idle' && this._state !== 'permission_denied' && this._state !== 'error') {
      return;
    }
    this.setState('requesting_permission');
    if (!this.globals.MediaRecorderCtor) {
      this.fail('not_supported', 'MediaRecorder is not available in this environment.');
      this.setState('permission_denied');
      return;
    }
    try {
      const stream = await this.globals.mediaDevices.getUserMedia({
        audio: this.audioConstraints,
      });
      this._mediaStream = stream;
      this.setState('ready');
    } catch (err) {
      this.fail('permission_denied', formatError(err, 'Microphone permission was denied.'));
      this.setState('permission_denied');
    }
  }

  /** Begin recording. Caller must have reached `ready` first. */
  async start(): Promise<void> {
    if (this._state === 'ready' || this._state === 'stopped' || this._state === 'recording_interrupted') {
      // From stopped or interrupted, discard the prior recording so we start clean.
      if (this._state !== 'ready') this.clearRecording();
      // If the stream was torn down between recordings, re-acquire.
      if (!this._mediaStream) {
        await this.requestPermission();
        if (this._state !== 'ready') return;
      }
    } else {
      return;
    }

    const mime = this.pickMimeType();
    if (!mime) {
      this.fail('not_supported', 'No supported audio MIME type for MediaRecorder.');
      this.setState('error');
      return;
    }

    try {
      const recorder = new this.globals.MediaRecorderCtor(this._mediaStream!, { mimeType: mime });
      this._recorder = recorder;
      this._mime = mime;
      this._chunks = [];
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) this._chunks.push(event.data);
      };
      recorder.onerror = () => {
        this.fail('unknown', 'MediaRecorder error.');
        this.cleanupStreamAndTimers();
        this.setState('error');
      };
      recorder.onstop = () => this.handleRecorderStopped();
      recorder.start(/* timeslice */ 1000);
      this._recordedBefore = 0;
      this.runClock();
      this.setState('recording');
    } catch (err) {
      this.fail('start_failed', formatError(err, 'Could not start recording.'));
      this.cleanupStreamAndTimers();
      this.setState('error');
    }
  }

  /** Pause mid-answer: the audio so far is kept, the clock and the time limit stop. */
  pause(): void {
    if (this._state !== 'recording' || !this._recorder || !this.canPause) return;
    try {
      this._recorder.pause();
    } catch (err) {
      this.fail('unknown', formatError(err, 'Could not pause recording.'));
      return;
    }
    this._recordedBefore += Date.now() - this._startedAt;
    this.stopClock();
    this.emitDuration(this._recordedBefore);
    this.setState('paused');
  }

  /** Go on recording into the same answer. */
  resume(): void {
    if (this._state !== 'paused' || !this._recorder) return;
    try {
      this._recorder.resume();
    } catch (err) {
      this.fail('unknown', formatError(err, 'Could not resume recording.'));
      return;
    }
    this.runClock();
    this.setState('recording');
  }

  /** Stop recording. The onstop handler finalizes the Recording blob. */
  stop(): void {
    if (this._state !== 'recording' && this._state !== 'paused' && this._state !== 'recording_interrupted') return;
    try {
      this._recorder?.stop();
    } catch (err) {
      this.fail('stop_failed', formatError(err, 'Could not stop recording.'));
      this.cleanupStreamAndTimers();
      this.setState('error');
    }
  }

  /** Play back the last recorded audio. */
  async play(): Promise<void> {
    if (this._state !== 'stopped' && this._state !== 'recording_interrupted') return;
    if (!this._recording) return;
    try {
      if (!this._blobUrl) this._blobUrl = URL.createObjectURL(this._recording.blob);
      if (!this._audio) {
        this._audio = this.globals.createAudio(this._blobUrl);
        this._audio.onended = () => this.setState('stopped');
        this._audio.onerror = () => {
          this.fail('playback_failed', 'Playback failed.');
          this.setState('stopped');
        };
      } else {
        this._audio.src = this._blobUrl;
        this._audio.currentTime = 0;
      }
      this.setState('playing');
      await this._audio.play();
    } catch (err) {
      this.fail('playback_failed', formatError(err, 'Could not start playback.'));
      this.setState('stopped');
    }
  }

  /** Pause playback. */
  pausePlayback(): void {
    if (this._state !== 'playing') return;
    this._audio?.pause();
    this.setState('stopped');
  }

  /** Discard the current recording and return to ready (if permission still granted). */
  reset(): void {
    if (this._state === 'recording' || this._state === 'paused' || this._state === 'requesting_permission') return;
    this.clearRecording();
    this.setState(this._mediaStream ? 'ready' : 'idle');
  }

  /** Full teardown: stop recording, release the microphone, revoke blob URLs, drop listeners. */
  destroy(): void {
    if (this._recorder && (this._state === 'recording' || this._state === 'paused')) {
      try {
        this._recorder.stop();
      } catch {
        // ignore
      }
    }
    this.cleanupStreamAndTimers();
    this.clearRecording();
    if (this._audio) {
      this._audio.pause();
      this._audio.src = '';
      this._audio = null;
    }
    this.uninstallVisibilityHandler();
    this._stateListeners.clear();
    this._durationListeners.clear();
    this._errorListeners.clear();
    this.setState('idle');
  }

  // ── Internals ─────────────────────────────────────────────────────────────────

  private pickMimeType(): string {
    for (const type of PREFERRED_MIME_TYPES) {
      if (this.globals.isTypeSupported(type)) return type;
    }
    return '';
  }

  /** The clock (shown every 200 ms) and the time limit, from now; what was recorded before counts. */
  private runClock(): void {
    this.stopClock();
    this._startedAt = Date.now();
    this._durationTimer = setInterval(() => {
      this.emitDuration(this._recordedBefore + Date.now() - this._startedAt);
    }, 200);
    this._maxTimer = setTimeout(
      () => {
        if (this._state === 'recording') this.stop();
      },
      Math.max(0, this.maxDurationMs - this._recordedBefore),
    );
  }

  private stopClock(): void {
    if (this._durationTimer) {
      clearInterval(this._durationTimer);
      this._durationTimer = null;
    }
    if (this._maxTimer) {
      clearTimeout(this._maxTimer);
      this._maxTimer = null;
    }
  }

  private handleRecorderStopped(): void {
    // Time recorded: before the last pause, plus since the last resume unless it ended paused.
    const running = this._durationTimer !== null && this._startedAt ? Date.now() - this._startedAt : 0;
    const durationMs = this._recordedBefore + running;
    this._recordedBefore = 0;
    const blob = new Blob(this._chunks, { type: this._mime || 'audio/webm' });
    this._recording = { blob, mimeType: this._mime || blob.type, durationMs };
    this._chunks = [];
    this.cleanupStreamAndTimers();
    // If we're currently in recording_interrupted (visibility change) keep that state until
    // the user explicitly resets; otherwise land in stopped.
    if (this._state !== 'recording_interrupted') this.setState('stopped');
  }

  private cleanupStreamAndTimers(): void {
    this.stopClock();
    if (this._mediaStream) {
      for (const track of this._mediaStream.getTracks()) track.stop();
      this._mediaStream = null;
    }
    this._recorder = null;
  }

  private clearRecording(): void {
    this._recording = null;
    if (this._blobUrl) {
      URL.revokeObjectURL(this._blobUrl);
      this._blobUrl = null;
    }
    if (this._audio) {
      this._audio.pause();
      this._audio.src = '';
      this._audio = null;
    }
    this._chunks = [];
  }

  private installVisibilityHandler(): void {
    const doc = this.globals.doc;
    if (!doc) return;
    this._onVisibilityChange = () => {
      if (doc.hidden && this._state === 'recording') {
        // Stop the recorder, but mark interrupted so the UI can tell the user.
        this.setState('recording_interrupted');
        try {
          this._recorder?.stop();
        } catch {
          // ignore
        }
      }
    };
    doc.addEventListener('visibilitychange', this._onVisibilityChange);
  }

  private uninstallVisibilityHandler(): void {
    const doc = this.globals.doc;
    if (doc && this._onVisibilityChange) {
      doc.removeEventListener('visibilitychange', this._onVisibilityChange);
    }
    this._onVisibilityChange = null;
  }

  private setState(next: RecorderState): void {
    if (this._state === next) return;
    this._state = next;
    for (const l of this._stateListeners) l(next);
  }

  private emitDuration(ms: number): void {
    for (const l of this._durationListeners) l(ms);
  }

  private fail(code: RecorderErrorCode, message: string): void {
    const err = new RecorderError(code, message);
    this._lastError = err;
    for (const l of this._errorListeners) l(err);
  }
}

function defaultGlobals(): RecorderGlobals {
  if (typeof window === 'undefined') {
    throw new RecorderError('not_supported', 'AudioRecorder requires a browser environment.');
  }
  const w = window as Window & { MediaRecorder?: typeof MediaRecorder };
  if (!w.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
    throw new RecorderError('not_supported', 'Browser does not support audio recording.');
  }
  const MR = w.MediaRecorder;
  return {
    mediaDevices: navigator.mediaDevices,
    MediaRecorderCtor: MR,
    isTypeSupported: (t) => MR.isTypeSupported(t),
    createAudio: (src) => new Audio(src),
    doc: document,
  };
}

function formatError(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

/** Check whether the environment can record audio at all (for UI gating). */
export function isAudioRecordingSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as Window & { MediaRecorder?: typeof MediaRecorder };
  return !!w.MediaRecorder && !!navigator.mediaDevices?.getUserMedia;
}
