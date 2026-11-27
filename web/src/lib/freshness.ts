/**
 * An open tab picks up a new release. The page itself is always fetched fresh (the service worker
 * goes to the network first for pages), but a tab left open keeps running the code it opened with,
 * for hours: on 27 November 2026 learners kept making shadowing sentences with code two releases
 * old, and a lazy screen of an old build, gone from the server, failed to load.
 *
 * - A lazy screen that can't be loaded (its build is gone): the page reloads, once.
 * - When the tab comes back into view, and every 15 minutes, the page asks whether a newer build
 *   is out; if so, it reloads at the next change of tab in the bottom bar, never in the middle of
 *   something.
 *
 * The service worker and what the device keeps offline are untouched (ADR 0060).
 */

const CHECK_EVERY_MS = 15 * 60 * 1000;
const RELOADED_KEY = 'freshness-reloaded';
const TAB_KEY = 'freshness-tab';
const BUILD = /\/assets\/(index-[\w-]+\.js)/;

/** The main script's name in a page: it changes with every build. */
export function buildOf(html: string): string | null {
  return BUILD.exec(html)?.[1] ?? null;
}

/** Whether `latest` is another build than the one running (unknown on either side: no). */
export function isNewer(running: string | null, latest: string | null): boolean {
  return running !== null && latest !== null && running !== latest;
}

function runningBuild(): string | null {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  return script ? buildOf(script.getAttribute('src') ?? '') : null;
}

let newer = false;

/** Reload, unless this very build already did (a server still serving the old page). */
function reloadOnce(): boolean {
  const running = runningBuild() ?? 'dev';
  try {
    if (sessionStorage.getItem(RELOADED_KEY) === running) return false;
    sessionStorage.setItem(RELOADED_KEY, running);
  } catch {
    // No storage: reload all the same; the next page is a newer build or the same failure.
  }
  window.location.reload();
  return true;
}

async function check(): Promise<void> {
  if (!navigator.onLine) return;
  try {
    // A query the service worker has never kept, so the answer is the server's page of now.
    const page = await fetch(`/?build=${Date.now()}`, { cache: 'no-store' });
    if (page.ok && isNewer(runningBuild(), buildOf(await page.text()))) newer = true;
  } catch {
    // Offline or the server busy: ask again later.
  }
}

/** Starts watching; only in a built app (in development there are no builds to compare). */
export function watchForNewBuild(): void {
  if (runningBuild() === null) return;
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadOnce()) event.preventDefault();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
  window.setInterval(() => void check(), CHECK_EVERY_MS);
}

/**
 * At a calm moment (a tab chosen in the bottom bar): reloads into the newer build if there is one,
 * and the new page opens that tab (`takePendingTab`).
 */
export function reloadIfNewer(tab: string): boolean {
  if (!newer) return false;
  try {
    sessionStorage.setItem(TAB_KEY, tab);
  } catch {
    // No storage: the new page opens on its first screen.
  }
  return reloadOnce();
}

/** The tab chosen just before a reload into a newer build, once. */
export function takePendingTab(): string | null {
  try {
    const tab = sessionStorage.getItem(TAB_KEY);
    sessionStorage.removeItem(TAB_KEY);
    return tab;
  } catch {
    return null;
  }
}
