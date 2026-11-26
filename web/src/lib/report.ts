/**
 * The app's own errors, reported (ADR 0094): when something fails that the learner can only be
 * told «Что-то пошло не так», what failed goes to the server, so a problem on one device can be
 * found. Never words or answers: where, the error's name, message and stack, and the build. Each
 * different error once per visit; reporting never fails anything itself.
 */
import { request } from './api.ts';

const sent = new Set<string>();

/** The build this page runs (its main file's name changes with every deploy). */
function build(): string {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  return script?.getAttribute('src')?.split('/').pop() ?? 'dev';
}

export function reportError(place: string, error: unknown): void {
  const e = error instanceof Error ? error : new Error(String(error));
  const key = `${place}|${e.name}|${e.message}`;
  if (sent.has(key)) return;
  sent.add(key);
  try {
    void request('POST', '/client-errors', {
      place: place.slice(0, 200),
      name: (e.name || 'Error').slice(0, 200),
      message: (e.message || String(error)).slice(0, 4000),
      stack: (e.stack ?? '').slice(0, 8000),
      build: build().slice(0, 200),
    }).catch(() => undefined);
  } catch {
    // Not even the request could be made: nothing more to do.
  }
}
