/**
 * Background music for a spelling test: an upbeat quiz-show loop, synthesised with the Web Audio
 * API like the reward sounds (`sounds.ts`): an original tune, no files to load or license. Four
 * bars in A minor (Am–F–C–G): kick on the beat, hi-hat off the beat, a bouncing bass and a plucked
 * tune. In the last minute it speeds up and the hi-hat doubles, so time running out is heard.
 *
 * `score` is pure (what plays on each sixteenth) so it can be tested; `Music` schedules it a little
 * ahead of the audio clock, the standard way to keep Web Audio in time. Any failure stays silent.
 */

export const STEPS = 16; // sixteenths in a bar
export const BARS = 4;
export const TEMPO = 128; // beats per minute
export const URGENT_TEMPO = 152;

export type Voice = 'kick' | 'hat' | 'bass' | 'pluck';
export interface Hit {
  voice: Voice;
  /** MIDI note number; absent for drums. */
  midi?: number;
  /** Length in sixteenths. */
  steps?: number;
}

const A2 = 45;
// Each bar's chord root (A, F, C, G), as semitones above A2.
const ROOTS = [0, -4, 3, -2];
// The bass: root, octave and fifth on a syncopated pattern (step → interval).
const BASS: [number, number][] = [
  [0, 0],
  [3, 12],
  [6, 7],
  [8, 0],
  [11, 12],
  [14, 7],
];
// The tune, one bar per chord: [step, MIDI note, length]. Notes of A minor only.
const TUNE: [number, number, number][][] = [
  [
    [0, 69, 2],
    [3, 72, 2],
    [6, 76, 2],
    [8, 74, 2],
    [10, 72, 2],
    [12, 69, 3],
  ],
  [
    [0, 65, 2],
    [3, 69, 2],
    [6, 72, 2],
    [8, 74, 2],
    [10, 72, 1],
    [11, 69, 1],
    [12, 72, 3],
  ],
  [
    [0, 72, 2],
    [3, 76, 2],
    [6, 79, 2],
    [8, 76, 2],
    [10, 74, 2],
    [12, 72, 3],
  ],
  [
    [0, 71, 2],
    [3, 74, 2],
    [6, 79, 2],
    [8, 74, 1],
    [9, 76, 1],
    [10, 74, 2],
    [12, 71, 2],
    [14, 74, 2],
  ],
];

/** Everything that sounds on one sixteenth of the loop. */
export function score(bar: number, step: number, urgent: boolean): Hit[] {
  const b = ((bar % BARS) + BARS) % BARS;
  const hits: Hit[] = [];
  if (step % 4 === 0) hits.push({ voice: 'kick' });
  if (step % 4 === 2 || (urgent && step % 2 === 1)) hits.push({ voice: 'hat' });
  for (const [at, interval] of BASS) {
    if (at === step) hits.push({ voice: 'bass', midi: A2 + ROOTS[b] + interval, steps: 2 });
  }
  for (const [at, midi, steps] of TUNE[b]) {
    if (at === step) hits.push({ voice: 'pluck', midi, steps });
  }
  return hits;
}

/** Seconds per sixteenth at a tempo. */
export const sixteenth = (tempo: number) => 60 / tempo / 4;

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

const LOOKAHEAD_S = 0.12;
const TICK_MS = 25;
const VOLUME = 0.22;

export class Music {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private next = 0; // audio-clock time of the next sixteenth
  private position = 0; // sixteenths since the start
  urgent = false;

  get playing(): boolean {
    return this.timer !== null;
  }

  start() {
    if (this.timer !== null || typeof window === 'undefined' || !('AudioContext' in window)) return;
    try {
      this.ctx ??= new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      const master = this.ctx.createGain();
      master.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      master.gain.exponentialRampToValueAtTime(VOLUME, this.ctx.currentTime + 0.4); // fade in
      master.connect(this.ctx.destination);
      this.master = master;
      this.noise ??= this.whiteNoise(this.ctx);
      this.next = this.ctx.currentTime + 0.05;
      this.position = 0;
      this.timer = setInterval(() => this.schedule(), TICK_MS);
      this.schedule();
    } catch {
      this.stop();
    }
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const { ctx, master } = this;
    this.master = null;
    if (ctx && master) {
      try {
        // A short fade, so it never ends on a click.
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(master.gain.value || VOLUME, ctx.currentTime);
        master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
        setTimeout(() => master.disconnect(), 400);
      } catch {
        // Already gone.
      }
    }
  }

  /** The page went to the background: hold the clock still, and pick up where it was. */
  pause() {
    if (this.ctx?.state === 'running') void this.ctx.suspend();
  }

  resume() {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  private schedule() {
    const { ctx } = this;
    if (!ctx || !this.master) return;
    // Behind (the tab slept)? Skip ahead rather than play the backlog all at once.
    if (this.next < ctx.currentTime - 0.2) this.next = ctx.currentTime + 0.02;
    const step = sixteenth(this.urgent ? URGENT_TEMPO : TEMPO);
    while (this.next < ctx.currentTime + LOOKAHEAD_S) {
      const bar = Math.floor(this.position / STEPS);
      for (const hit of score(bar, this.position % STEPS, this.urgent)) this.play(hit, this.next, step);
      this.next += step;
      this.position = (this.position + 1) % (STEPS * BARS);
    }
  }

  private play(hit: Hit, at: number, step: number) {
    const ctx = this.ctx!;
    const out = this.master!;
    const gain = ctx.createGain();
    gain.connect(out);
    if (hit.voice === 'kick') {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(130, at);
      osc.frequency.exponentialRampToValueAtTime(42, at + 0.12);
      envelope(gain, at, 0.9, 0.18);
      osc.connect(gain);
      osc.start(at);
      osc.stop(at + 0.2);
    } else if (hit.voice === 'hat') {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 7000;
      envelope(gain, at, 0.18, 0.045);
      src.connect(filter).connect(gain);
      src.start(at);
      src.stop(at + 0.06);
    } else {
      const length = (hit.steps ?? 1) * step;
      const osc = ctx.createOscillator();
      osc.type = hit.voice === 'bass' ? 'triangle' : 'square';
      osc.frequency.value = hz(hit.midi!);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = hit.voice === 'bass' ? 900 : 2400;
      envelope(gain, at, hit.voice === 'bass' ? 0.55 : 0.16, Math.max(0.08, length * 0.9));
      osc.connect(filter).connect(gain);
      osc.start(at);
      osc.stop(at + length + 0.05);
    }
  }

  private whiteNoise(ctx: AudioContext): AudioBuffer {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
}

/** A quick attack and an exponential fade: plucked, not droning. */
function envelope(gain: GainNode, at: number, peak: number, length: number) {
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
}

const KEY = 'test-music';

/** Whether the learner wants music in tests; until they choose, it follows their sounds setting. */
export function musicOn(): boolean {
  try {
    const chosen = localStorage.getItem(KEY);
    if (chosen) return chosen === 'on';
    return localStorage.getItem('sounds') !== 'off';
  } catch {
    return true;
  }
}

export function setMusicOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
}
