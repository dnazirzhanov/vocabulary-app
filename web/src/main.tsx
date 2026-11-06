import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/nunito';
import './styles/tokens.css';
import './styles/global.css';
import { loadLanguage } from './i18n/index.ts';

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
