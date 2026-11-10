import { isApp } from './platform.ts';
import { glossarySlug } from './tokens.ts';

/**
 * Pronunciation (ADR 0013). Words, examples and glossary forms play recorded files generated with
 * a neural voice (content/tools/make_audio.py), so every learner hears the same clear voice. If a
 * file is missing (the learner's own cards), the browser's own English voice is used, or in the
 * Android app the phone's.
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
async function speakOnPhone(text: string) {
  const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
  await TextToSpeech.stop().catch(() => undefined);
  // The phone's voice engine connects on first use and refuses until then ("language not
  // supported"): the first tap after opening the app tries again for up to about 2 seconds.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await TextToSpeech.speak({ text, lang: 'en-US', rate: 1, category: 'playback' });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
}

function speakFallback(text: string) {
  if (isApp) {
    void speakOnPhone(text);
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
  if (voice) utterance.voice = voice;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

/** Plays `key`'s recording; `text` is spoken by the browser if there is no file. */
export async function playAudio(kind: AudioKind, key: string, text: string): Promise<void> {
  if (typeof Audio === 'undefined') return;
  playing?.pause();
  const audio = player(urlFor(kind, key));
  playing = audio;
  audio.currentTime = 0;
  try {
    await audio.play();
  } catch (error) {
    // Autoplay before any tap is blocked by browsers: stay quiet rather than fall back.
    if (error instanceof DOMException && error.name === 'NotAllowedError') return;
    speakFallback(text);
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
