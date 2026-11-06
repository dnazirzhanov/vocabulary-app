import { startingLanguage, type UiLanguage } from './languages.ts';
import { ru, type Messages } from './ru.ts';

/**
 * The app's text, in the language chosen. It is set before the app's own code is imported (see
 * main.tsx) and changing language reloads the page, so nothing built at import time can stay in the
 * old language (ADR 0055). Each language other than Russian downloads only if chosen.
 */
export let t: Messages = ru;
export let uiLanguage: UiLanguage = 'ru';

const OTHERS: Record<Exclude<UiLanguage, 'ru'>, () => Promise<Messages>> = {
  en: () => import('./en.ts').then((module) => module.en),
  uz: () => import('./uz.ts').then((module) => module.uz),
  kk: () => import('./kk.ts').then((module) => module.kk),
  ky: () => import('./ky.ts').then((module) => module.ky),
  tg: () => import('./tg.ts').then((module) => module.tg),
};
const SAVED_KEY = 'ui-language';

function saved(): string | null {
  try {
    return localStorage.getItem(SAVED_KEY);
  } catch {
    return null; // private mode, blocked storage
  }
}

/** Before the app starts. If a language can't be downloaded, Russian is still there. */
export async function loadLanguage(): Promise<void> {
  const language = startingLanguage(saved(), navigator.languages ?? []);
  if (language !== 'ru') {
    const load = OTHERS[language];
    try {
      t = await load();
      uiLanguage = language;
    } catch {
      // Stays Russian.
    }
  }
  document.documentElement.lang = uiLanguage;
  document.title = t.slovar;
  document.querySelector('link[rel="manifest"]')?.setAttribute('href', `/manifest-${uiLanguage}.webmanifest`);
}

/** Saves the choice and reloads into it. False if it can't be saved: reloading would only loop. */
export function switchLanguage(language: UiLanguage): boolean {
  try {
    localStorage.setItem(SAVED_KEY, language);
  } catch {
    return false;
  }
  if (saved() !== language) return false;
  location.reload();
  return true;
}
