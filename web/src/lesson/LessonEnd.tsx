import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './LessonEnd.module.css';

interface LessonEndProps {
  reason: 'complete' | 'exited';
  correct: number;
  answered: number;
  onRestart: () => void;
}

// Deliberately minimal: the session summary is the next screen to design.
export function LessonEnd({ reason, correct, answered, onRestart }: LessonEndProps) {
  return (
    <main className={styles.end}>
      <h1 className={styles.title}>{reason === 'complete' ? 'Урок пройден' : 'Урок прерван'}</h1>
      <p className={styles.detail}>
        Верных ответов: {correct} из {answered}
      </p>
      <PrimaryButton type="button" onClick={onRestart} autoFocus>
        {reason === 'complete' ? 'Пройти ещё раз' : 'Начать заново'}
      </PrimaryButton>
    </main>
  );
}
