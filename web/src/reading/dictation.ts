/**
 * Speaking an answer instead of typing it (round 2): the phone's or browser's own recognition,
 * English, free, and no audio sent to us (ADR in docs/experiments/reading-mode/decisions.md).
 * Here the browser's Web Speech API; the Android app gets the system recognizer in R2-E. Where
 * neither exists, no 🎤 is shown and the keyboard's own microphone still works.
 */

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

export const canDictate = () => engine() !== null;

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
