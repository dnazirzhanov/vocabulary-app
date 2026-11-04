import { api } from './api.ts';
import { isAppleMobile, keyBytes } from './device.ts';

/**
 * Deadline reminders on the phone by Web Push (ADR 0031). The browser asks once for permission;
 * the push service then delivers the evening's reminder even with the app closed. iPhones and
 * iPads only allow it once the app is on the home screen.
 */
export type PushState =
  /** This browser can't receive push at all. */
  | 'unsupported'
  /** An iPhone or iPad, in Safari: first «На экран „Домой“». */
  | 'needs_install'
  /** The server has no reminder keys (development without them). */
  | 'unavailable'
  /** The learner said no in the browser; only the browser's settings can undo it. */
  | 'denied'
  | 'off'
  | 'on';

const WORKER = '/sw.js';
const FORGET_WAIT_MS = 3000;

function installed(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function subscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration(WORKER);
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return isAppleMobile() && !installed() ? 'needs_install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const { public_key: key } = await api.pushKey();
  if (!key) return 'unavailable';
  return (await subscription()) ? 'on' : 'off';
}

/** Asks for permission (the browser's own prompt), subscribes this device and tells the server. */
export async function enablePush(): Promise<PushState> {
  const { public_key: key } = await api.pushKey();
  if (!key) return 'unavailable';
  if ((await Notification.requestPermission()) !== 'granted')
    return Notification.permission === 'denied' ? 'denied' : 'off';
  const registration = await navigator.serviceWorker.register(WORKER);
  await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const device =
    existing ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
  await api.subscribePush(device.toJSON());
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const device = await subscription();
  if (device) {
    await api.unsubscribePush(device.endpoint);
    await device.unsubscribe();
  }
  return 'off';
}

/**
 * Signing out on a shared phone: the next person must not get this learner's reminders. The server
 * is told if it answers quickly; the browser unsubscribes regardless, and the push service then
 * tells the server the subscription is gone.
 */
export async function forgetDevice(): Promise<void> {
  if (!supported()) return;
  const device = await subscription();
  if (!device) return;
  const told = api.unsubscribePush(device.endpoint).catch(() => null);
  await Promise.race([told, new Promise((resolve) => setTimeout(resolve, FORGET_WAIT_MS))]);
  await device.unsubscribe();
}
