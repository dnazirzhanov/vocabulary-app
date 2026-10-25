import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/nunito';
import './styles/tokens.css';
import './styles/global.css';
import { demoLesson } from './lesson/demoLesson.ts';
import { LessonScreen } from './lesson/LessonScreen.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LessonScreen exercises={demoLesson} />
  </StrictMode>,
);
