/**
 * Reward sounds (ADR 0024), synthesised with the Web Audio API: no files to load or license, and
 * the same tones everywhere. A short bright chime for a word spelled right; a rising arpeggio
 * with a final chord when something is finished. Learners can turn sounds off (`setSoundsOn`).
 * Sounds only follow a tap, so browsers allow them; any failure stays silent.
 */

const KEY = 'sounds';
let context: AudioContext | null = null;

export function soundsOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundsOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
}

function audio(): AudioContext | null {
  if (!soundsOn() || typeof window === 'undefined' || !('AudioContext' in window)) return null;
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    return context;
  } catch {
    return null;
  }
}

/**
 * One soft bell-like note: a sine with a quieter octave above, a quick attack and an exponential
 * fade, so it rings rather than beeps.
 */
function note(ctx: AudioContext, frequency: number, start: number, length: number, volume: number) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  gain.connect(ctx.destination);
  for (const [multiple, level] of [
    [1, 1],
    [2, 0.25],
  ] as const) {
    const tone = ctx.createOscillator();
    const partial = ctx.createGain();
    tone.type = 'sine';
    tone.frequency.value = frequency * multiple;
    partial.gain.value = level;
    tone.connect(partial).connect(gain);
    tone.start(start);
    tone.stop(start + length + 0.05);
  }
}

// Equal-tempered pitches (Hz).
const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;
const E6 = 1318.51;
const G6 = 1567.98;
const A6 = 1760;

/** A word spelled right: two quick rising notes (E6, A6), about a third of a second. */
export function playCorrect() {
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime + 0.01;
  note(ctx, E6, now, 0.22, 0.16);
  note(ctx, A6, now + 0.08, 0.32, 0.14);
}

/** Something finished: a rising C-major arpeggio, then the chord ringing out, under 2 seconds. */
export function playCelebration() {
  const ctx = audio();
  if (!ctx) return;
  const now = ctx.currentTime + 0.02;
  [C5, E5, G5, C6].forEach((pitch, index) => note(ctx, pitch, now + index * 0.11, 0.5, 0.13));
  const chord = now + 0.5;
  for (const pitch of [C5, E5, G5, C6, E6]) note(ctx, pitch, chord, 1.3, 0.07);
  // A little sparkle on top as the chord blooms.
  [G6, C6 * 2, E6 * 2].forEach((pitch, index) => note(ctx, pitch, chord + 0.08 + index * 0.07, 0.35, 0.035));
}
