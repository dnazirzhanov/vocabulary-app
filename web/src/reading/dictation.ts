/**
 * Speaking an answer instead of typing it (round 2): the phone's or browser's own recognition,
 * English, free, and no audio sent to us (ADR in docs/experiments/reading-mode/decisions.md).
 * In a browser, the Web Speech API; in the Android app (whose web view has none), the phone's own
 * recognizer through a Capacitor plugin. Where neither exists, no 🎤 is shown and the keyboard's own
 * microphone still works.
 */

import { isApp } from '../lib/platform.ts';

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}

interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type RecognitionClass = new () => Recognition;

function engine(): RecognitionClass | null {
  if (typeof window === 'undefined') return null;
  const found = window as unknown as {
    SpeechRecognition?: RecognitionClass;
    webkitSpeechRecognition?: RecognitionClass;
  };
  return found.SpeechRecognition ?? found.webkitSpeechRecognition ?? null;
}

export const canDictate = () => isApp || engine() !== null;

export interface Dictation {
  stop: () => void;
}

/**
 * Listens until stopped (or silence ends it): `onText` gets everything heard so far, final and
 * still changing, as one string; `onEnd` says why it stopped (`blocked`: no microphone allowed).
 */
export function dictate(
  onText: (heard: string) => void,
  onEnd: (reason: 'done' | 'blocked' | 'failed') => void,
): Dictation {
  if (isApp) return dictateOnPhone(onText, onEnd);
  const Engine = engine();
  if (!Engine) {
    onEnd('failed');
    return { stop: () => undefined };
  }
  const recognition = new Engine();
  recognition.lang = 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;
  let finished = '';
  let reason: 'done' | 'blocked' | 'failed' = 'done';
  recognition.onresult = (event) => {
    let changing = '';
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result.isFinal) finished = `${finished} ${result[0].transcript}`.trim();
      else changing = `${changing} ${result[0].transcript}`;
    }
    onText(`${finished} ${changing}`.trim());
  };
  recognition.onerror = (event) => {
    reason = event.error === 'not-allowed' || event.error === 'service-not-allowed' ? 'blocked' : 'failed';
  };
  recognition.onend = () => onEnd(reason);
  recognition.start();
  return { stop: () => recognition.stop() };
}

/**
 * In the Android app: the phone's recognizer (Google's, or the maker's), English. It asks for the
 * microphone on first use; it listens until a pause, and a second tap goes on after what was said.
 */
function dictateOnPhone(
  onText: (heard: string) => void,
  onEnd: (reason: 'done' | 'blocked' | 'failed') => void,
): Dictation {
  let stopped = false;
  let finished = false;
  let stopNow: () => void = () => {
    stopped = true;
  };
  const finish = (reason: 'done' | 'blocked' | 'failed') => {
    if (finished) return;
    finished = true;
    onEnd(reason);
  };
  void (async () => {
    try {
      const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
      if (!(await SpeechRecognition.available()).available) return finish('failed');
      let allowed = (await SpeechRecognition.checkPermissions()).speechRecognition;
      if (allowed !== 'granted') allowed = (await SpeechRecognition.requestPermissions()).speechRecognition;
      if (allowed !== 'granted') return finish('blocked');
      if (stopped) return finish('done');
      await SpeechRecognition.removeAllListeners();
      await SpeechRecognition.addListener('partialResults', ({ matches }) => {
        if (matches?.[0]) onText(matches[0]);
      });
      await SpeechRecognition.addListener('listeningState', ({ status }) => {
        if (status === 'stopped') {
          void SpeechRecognition.removeAllListeners();
          finish('done');
        }
      });
      stopNow = () => void SpeechRecognition.stop().catch(() => finish('done'));
      // With partial results, Android answers at once and sends what it hears as it hears it.
      await SpeechRecognition.start({ language: 'en-US', partialResults: true, popup: false });
    } catch {
      finish('failed');
    }
  })();
  return { stop: () => stopNow() };
}
