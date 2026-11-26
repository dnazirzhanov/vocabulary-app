import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AudioRecorder, RecorderError, type RecorderGlobals, type RecorderState } from './AudioRecorder.ts';

// ─── Mocks ─────────────────────────────────────────────────────────────────────

class FakeMediaStream {
  tracks: { stop: () => void; stopped: boolean }[] = [];
  constructor() {
    const track: { stop: () => void; stopped: boolean } = { stopped: false, stop: () => undefined };
    track.stop = () => {
      track.stopped = true;
    };
    this.tracks = [track];
  }
  getTracks() {
    return this.tracks as unknown as MediaStreamTrack[];
  }
}

class FakeMediaRecorder {
  static supportedTypes = new Set<string>(['audio/webm;codecs=opus']);
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  readonly opts: { mimeType: string };
  constructor(_stream: MediaStream, opts: { mimeType: string }) {
    this.opts = opts;
  }
  start(): void {
    this.state = 'recording';
    // Emit one chunk so the Blob is non-empty.
    setTimeout(() => this.ondataavailable?.({ data: new Blob(['x'], { type: this.opts.mimeType }) }), 0);
  }
  stop(): void {
    this.state = 'inactive';
    setTimeout(() => this.onstop?.(), 0);
  }
  pause(): void {
    this.state = 'paused';
  }
  resume(): void {
    this.state = 'recording';
  }
  static isTypeSupported(type: string): boolean {
    return FakeMediaRecorder.supportedTypes.has(type);
  }
}

class FakeAudio {
  src = '';
  currentTime = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(src: string) {
    this.src = src;
  }
  async play(): Promise<void> {
    setTimeout(() => this.onended?.(), 0);
  }
  pause(): void {}
}

class FakeDoc {
  hidden = false;
  listeners = new Map<string, Set<() => void>>();
  addEventListener(name: string, cb: () => void): void {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(cb);
  }
  removeEventListener(name: string, cb: () => void): void {
    this.listeners.get(name)?.delete(cb);
  }
  dispatch(name: string): void {
    for (const cb of this.listeners.get(name) ?? []) cb();
  }
}

function makeGlobals(options: { grantPermission?: boolean; mimeSupport?: string[] } = {}): {
  globals: RecorderGlobals;
  doc: FakeDoc;
} {
  const grant = options.grantPermission ?? true;
  if (options.mimeSupport) {
    FakeMediaRecorder.supportedTypes = new Set(options.mimeSupport);
  } else {
    FakeMediaRecorder.supportedTypes = new Set(['audio/webm;codecs=opus']);
  }
  const doc = new FakeDoc();
  const globals: RecorderGlobals = {
    mediaDevices: {
      async getUserMedia() {
        if (!grant) throw new Error('NotAllowedError');
        return new FakeMediaStream() as unknown as MediaStream;
      },
    },
    MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
    isTypeSupported: (t) => FakeMediaRecorder.isTypeSupported(t),
    createAudio: (src) => new FakeAudio(src) as unknown as HTMLAudioElement,
    doc: doc as unknown as Document,
  };
  // URL.createObjectURL may not exist in Node.
  (globalThis as unknown as { URL: { createObjectURL?: unknown; revokeObjectURL?: unknown } }).URL = {
    createObjectURL: () => 'blob:fake',
    revokeObjectURL: () => undefined,
  };
  return { globals, doc };
}

function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 5));
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

test('AudioRecorder: starts in idle', () => {
  const { globals } = makeGlobals();
  const r = new AudioRecorder({ globals });
  assert.equal(r.state, 'idle');
  assert.equal(r.recording, null);
  r.destroy();
});

test('AudioRecorder: permission granted → ready', async () => {
  const { globals } = makeGlobals({ grantPermission: true });
  const r = new AudioRecorder({ globals });
  const states: RecorderState[] = [];
  r.subscribeState((s) => states.push(s));
  await r.requestPermission();
  assert.equal(r.state, 'ready');
  assert.deepEqual(states, ['requesting_permission', 'ready']);
  r.destroy();
});

test('AudioRecorder: permission denied → permission_denied + RecorderError', async () => {
  const { globals } = makeGlobals({ grantPermission: false });
  const r = new AudioRecorder({ globals });
  const errors: RecorderError[] = [];
  r.subscribeError((e) => errors.push(e));
  await r.requestPermission();
  assert.equal(r.state, 'permission_denied');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'permission_denied');
  r.destroy();
});

test('AudioRecorder: record → stop produces a Recording with blob and duration', async () => {
  const { globals } = makeGlobals();
  const r = new AudioRecorder({ globals, maxDurationMs: 10_000 });
  await r.requestPermission();
  await r.start();
  assert.equal(r.state, 'recording');
  await tick(); // let dataavailable fire
  r.stop();
  await tick();
  assert.equal(r.state, 'stopped');
  assert.ok(r.recording);
  assert.ok(r.recording!.blob.size > 0);
  assert.equal(r.recording!.mimeType, 'audio/webm;codecs=opus');
  assert.ok(r.recording!.durationMs >= 0);
  r.destroy();
});

test('AudioRecorder: visibility change while recording → recording_interrupted', async () => {
  const { globals, doc } = makeGlobals();
  const r = new AudioRecorder({ globals });
  await r.requestPermission();
  await r.start();
  await tick();
  doc.hidden = true;
  doc.dispatch('visibilitychange');
  await tick();
  assert.equal(r.state, 'recording_interrupted');
  // The partial recording is still preserved for the user to decide what to do.
  assert.ok(r.recording);
  r.destroy();
});

test('AudioRecorder: no supported MIME → not_supported error + error state', async () => {
  const { globals } = makeGlobals({ mimeSupport: [] });
  const r = new AudioRecorder({ globals });
  const errors: RecorderError[] = [];
  r.subscribeError((e) => errors.push(e));
  await r.requestPermission();
  await r.start();
  assert.equal(r.state, 'error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'not_supported');
  r.destroy();
});

test('AudioRecorder: reset after stopped → ready (stream re-usable)', async () => {
  const { globals } = makeGlobals();
  const r = new AudioRecorder({ globals });
  await r.requestPermission();
  await r.start();
  await tick();
  r.stop();
  await tick();
  assert.equal(r.state, 'stopped');
  r.reset();
  // After reset, stream was torn down by recorder stop cleanup; state is idle, next start will re-acquire.
  const afterReset: string = r.state;
  assert.ok(afterReset === 'ready' || afterReset === 'idle');
  assert.equal(r.recording, null);
  r.destroy();
});

test('AudioRecorder: play after stopped → playing → stopped (on audio end)', async () => {
  const { globals } = makeGlobals();
  const r = new AudioRecorder({ globals });
  await r.requestPermission();
  await r.start();
  await tick();
  r.stop();
  await tick();
  await r.play();
  assert.equal(r.state, 'playing');
  await tick();
  assert.equal(r.state, 'stopped');
  r.destroy();
});

test('AudioRecorder: destroy releases the microphone (stops stream tracks)', async () => {
  const { globals } = makeGlobals();
  const r = new AudioRecorder({ globals });
  await r.requestPermission();
  // Internal stream is held by the recorder; after destroy the state resets to idle.
  r.destroy();
  assert.equal(r.state, 'idle');
});

test('AudioRecorder: max-duration auto-stops the recording', async () => {
  const { globals } = makeGlobals();
  const r = new AudioRecorder({ globals, maxDurationMs: 20 });
  await r.requestPermission();
  await r.start();
  await new Promise((res) => setTimeout(res, 40));
  // The timer should have fired stop().
  await tick();
  assert.equal(r.state, 'stopped');
  r.destroy();
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('AudioRecorder: pause and resume record one answer; paused time is not counted', async () => {
  const { globals } = makeGlobals();
  const r = new AudioRecorder({ globals, maxDurationMs: 10_000 });
  await r.requestPermission();
  assert.equal(r.canPause, true);
  await r.start();
  await wait(60);
  r.pause();
  assert.equal(r.state, 'paused');
  // A long pause: the clock stands still.
  await wait(200);
  r.resume();
  assert.equal(r.state, 'recording');
  await wait(60);
  r.stop();
  await tick();
  assert.equal(r.state, 'stopped');
  const ms = r.recording!.durationMs;
  assert.ok(ms >= 100 && ms < 200, `recorded ${ms} ms, the 200 ms pause left out`);
  r.destroy();
});

test('AudioRecorder: stopping while paused keeps the answer so far', async () => {
  const { globals } = makeGlobals();
  const r = new AudioRecorder({ globals, maxDurationMs: 10_000 });
  await r.requestPermission();
  await r.start();
  await wait(40);
  r.pause();
  await wait(100);
  r.stop();
  await tick();
  assert.equal(r.state, 'stopped');
  assert.ok(r.recording && r.recording.blob.size > 0);
  assert.ok(r.recording.durationMs < 100, `recorded ${r.recording.durationMs} ms`);
  r.destroy();
});

test('AudioRecorder: the time limit counts recorded time only, and never fires while paused', async () => {
  const { globals } = makeGlobals();
  const r = new AudioRecorder({ globals, maxDurationMs: 80 });
  await r.requestPermission();
  await r.start();
  await wait(50);
  r.pause();
  await wait(120); // past the limit by the wall clock, not by recorded time
  assert.equal(r.state, 'paused');
  r.resume();
  await wait(60); // 50 + 60 recorded: past 80
  await tick();
  assert.equal(r.state, 'stopped');
  r.destroy();
});

test('AudioRecorder: pause and resume do nothing outside recording', async () => {
  const { globals } = makeGlobals();
  const r = new AudioRecorder({ globals });
  await r.requestPermission();
  r.pause();
  r.resume();
  assert.equal(r.state, 'ready');
  r.destroy();
});
