import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './LessonEnd.module.css';

interface LessonEndProps {
  correct: number;
  answered: number;
  onRestart: () => void;
}

// Shown after leaving a lesson early. Deliberately minimal until a home screen exists to return to.
export function LessonEnd({ correct, answered, onRestart }: LessonEndProps) {
  return (
    <main className={styles.end}>
      <h1 className={styles.title}>Урок прерван</h1>
      <p className={styles.detail}>
        Верных ответов: {correct} из {answered}
      </p>
      <PrimaryButton type="button" onClick={onRestart} autoFocus>
        Начать заново
      </PrimaryButton>
    </main>
  );
}
