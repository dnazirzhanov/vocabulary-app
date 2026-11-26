import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/nunito';
import './styles/tokens.css';
import './styles/global.css';
import { loadLanguage } from './i18n/index.ts';
import { isApp } from './lib/platform.ts';

// The app keeps itself on the device, so it opens without a connection (ADR 0060). Built apps
// only: in development the files change on every save. The Android app has its files inside it.
if (import.meta.env.PROD && !isApp && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch(() => null);
}

// An error nothing caught is reported, so a problem on one device can be found (ADR 0094).
const report = (error: unknown) =>
  void import('./lib/report.ts').then(({ reportError }) => reportError('uncaught', error)).catch(() => null);
// Not the browser's own noise: a layout loop warning, or another site's script («Script error.»).
const noise = (message: string) => /ResizeObserver loop|^Script error\.?$/.test(message);
window.addEventListener('error', (event) => {
  if (!noise(event.message ?? '')) report(event.error ?? event.message);
});
window.addEventListener('unhandledrejection', (event) => report(event.reason));

// The language first: the app's modules may read their text as they load.
void loadLanguage()
  .then(() => import('./App.tsx'))
  .then(({ App }) =>
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );
