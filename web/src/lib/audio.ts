import { apiBase, isApp } from './platform.ts';
import { glossarySlug } from './tokens.ts';

/**
 * Pronunciation (ADR 0013, 0070). Words, examples and glossary forms play recorded files generated
 * with the app's neural voice (content/tools/make_audio.py), so every learner hears the same clear
 * voice. A word or example with no file (a teacher's or learner's own card) is spoken by the same
 * voice on the server, once, and kept: the whole class hears the same thing. Only offline, or if
 * that fails, does the browser's own English voice speak, or in the Android app the phone's.
 */
export type AudioKind = 'words' | 'examples' | 'glossary';

const players = new Map<string, HTMLAudioElement>();
let playing: HTMLAudioElement | null = null;

export const urlFor = (kind: AudioKind, key: string) =>
  `/audio/${kind}/${encodeURIComponent(kind === 'glossary' ? glossarySlug(key) : key)}.mp3`;

function player(url: string): HTMLAudioElement {
  let audio = players.get(url);
  if (!audio) {
    audio = new Audio(url);
    audio.preload = 'auto';
    players.set(url, audio);
  }
  return audio;
}

/** Starts loading a file so it plays at once later (the next card's word). */
export function preloadAudio(kind: AudioKind, key: string) {
  if (typeof Audio !== 'undefined') player(urlFor(kind, key));
}

/** In the Android app: the phone's own voice, through Capacitor (its web view has no speechSynthesis). */
async function speakOnPhone(text: string, rate: number) {
  const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
  await TextToSpeech.stop().catch(() => undefined);
  // The phone's voice engine connects on first use and refuses until then ("language not
  // supported"): the first tap after opening the app tries again for up to about 2 seconds.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await TextToSpeech.speak({ text, lang: 'en-US', rate, category: 'playback' });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
}

function speakFallback(text: string, rate: number) {
  if (isApp) {
    void speakOnPhone(text, rate);
    return;
  }
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const voices = speechSynthesis.getVoices().filter((voice) => voice.lang.startsWith('en'));
  // Prefer the higher-quality voices browsers ship; any English voice beats a Russian one.
  const voice =
    voices.find((v) => /natural|premium|enhanced|google/i.test(v.name) && v.lang === 'en-US') ??
    voices.find((v) => v.lang === 'en-US') ??
    voices[0];
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = rate;
  if (voice) utterance.voice = voice;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

// Static files known to be missing, so the next tap goes straight to the server's voice.
const missing = new Set<string>();
// The server's recordings fetched this visit, by kind and text: an object URL, or null if it failed.
const voiced = new Map<string, Promise<string | null>>();

/** The server's recording of a card's word or example (signed in), as a playable URL. */
function serverVoice(kind: 'word' | 'example', text: string): Promise<string | null> {
  const id = `${kind}|${text}`;
  let found = voiced.get(id);
  if (!found) {
    found = (async () => {
      try {
        // Loaded when first needed: sign-in reads the build's settings, which plain unit tests lack.
        const { accessToken } = await import('./auth.ts');
        const token = await accessToken();
        const query = new URLSearchParams({ kind, text });
        const response = await fetch(`${apiBase}/pronunciation?${query}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) return null;
        return URL.createObjectURL(await response.blob());
      } catch {
        return null; // offline
      }
    })();
    voiced.set(id, found);
    // A failure is forgotten, so a later tap (back online) tries again.
    void found.then((url) => url === null && voiced.delete(id));
  }
  return found;
}

/** Plays the server's recording; false if there is none to play. */
async function playFromServer(kind: AudioKind, text: string, rate: number): Promise<boolean> {
  if (kind === 'glossary' || !text.trim()) return false;
  const url = await serverVoice(kind === 'words' ? 'word' : 'example', text);
  if (!url) return false;
  const audio = player(url);
  playing?.pause();
  playing = audio;
  audio.currentTime = 0;
  audio.playbackRate = rate;
  try {
    await audio.play();
    return true;
  } catch {
    return false;
  }
}

/** Plays `key`'s recording; without a file, the app's voice says `text` from the server, or the device does. */
export async function playAudio(kind: AudioKind, key: string, text: string): Promise<void> {
  if (typeof Audio === 'undefined') return;
  playing?.pause();
  const audio = player(urlFor(kind, key));
  // Examples at the learner's chosen speed; single words always as recorded.
  const rate = kind === 'examples' ? exampleRate() : 1;
  const url = urlFor(kind, key);
  if (missing.has(url)) {
    if (!(await playFromServer(kind, text, rate))) speakFallback(text, rate);
    return;
  }
  playing = audio;
  audio.currentTime = 0;
  audio.playbackRate = rate;
  try {
    await audio.play();
  } catch (error) {
    // Autoplay before any tap is blocked by browsers: stay quiet rather than fall back.
    if (error instanceof DOMException && error.name === 'NotAllowedError') return;
    missing.add(url);
    if (!(await playFromServer(kind, text, rate))) speakFallback(text, rate);
  }
}

const AUTOPLAY_KEY = 'autoplay-audio';

/** Whether each new card says its word by itself (on unless the learner turned it off). */
export function autoplayEnabled(): boolean {
  try {
    return localStorage.getItem(AUTOPLAY_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setAutoplay(on: boolean) {
  try {
    localStorage.setItem(AUTOPLAY_KEY, on ? 'on' : 'off');
  } catch {
    // private mode: the choice lasts for this visit only
  }
}

const SPEED_KEY = 'example-speed';
export const MIN_RATE = 0.5;
export const MAX_RATE = 2;
export const RATE_STEP = 0.25;

/** A speed the reader can play at: within 0.5×–2×, on a 0.25× step. */
export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  const stepped = Math.round(rate / RATE_STEP) * RATE_STEP;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, stepped));
}

/** How fast example sentences are read (the card's «⋯»), kept on this device; 1 is as recorded. */
export function exampleRate(): number {
  try {
    const kept = localStorage.getItem(SPEED_KEY);
    if (kept === null || kept === 'normal') return 1;
    if (kept === 'slow') return 0.75; // the earlier two-choice setting
    return clampRate(Number(kept));
  } catch {
    return 1;
  }
}

export function setExampleRate(rate: number) {
  try {
    localStorage.setItem(SPEED_KEY, String(clampRate(rate)));
  } catch {
    // private mode: the choice lasts for this visit only
  }
}
