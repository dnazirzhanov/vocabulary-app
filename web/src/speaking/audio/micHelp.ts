/**
 * When the microphone can't be had: what to tell the learner, and a report so it can be found.
 *
 * Learners open the site from a link in a chat. Telegram, Instagram, Facebook, WhatsApp and other
 * apps then show it in their own built-in browser, which often never asks for the microphone, or
 * refuses it at once. The fix is theirs to make in a tap: open the link in Chrome or Safari. Our
 * Android app is a built-in browser too, but asks for the microphone itself.
 */
import { t } from '../../i18n/index.ts';
import { reportError } from '../../lib/report.ts';
import { isApp } from '../../lib/platform.ts';
import { inAppBrowser } from './inAppBrowser.ts';

const agent = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent);

/** Whether this page is in an app's built-in browser (not ours). */
export const inAppNow = (): boolean => inAppBrowser(agent(), isApp) !== null;

/** What to say when recording can't start: denied, or not possible in this browser. */
export function micTrouble(kind: 'denied' | 'unsupported', userAgent = agent()): string {
  if (inAppBrowser(userAgent, isApp)) return t.micInAppBrowser;
  return kind === 'denied' ? t.shadowingPermissionDenied : t.shadowingUnsupported;
}

/** Each failure goes to the app's error reports (ADR 0094), with the browser, once per visit. */
export function reportMic(place: string, error: unknown): void {
  const found = error instanceof Error ? error : new Error(String(error));
  const where = inAppBrowser(agent(), isApp);
  reportError(`mic/${place}${where ? `/in-app-${where}` : ''}`, found);
}
