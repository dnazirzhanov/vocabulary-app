import styles from './LessonProgress.module.css';

interface LessonProgressProps {
  answered: number;
  total: number;
}

export function LessonProgress({ answered, total }: LessonProgressProps) {
  return (
    <div className={styles.progress}>
      <div
        className={styles.track}
        role="progressbar"
        aria-label="Прогресс урока"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={answered}
        aria-valuetext={`${answered} из ${total}`}
      >
        <div className={styles.fill} style={{ width: `${(answered / total) * 100}%` }} />
      </div>
      <span className={styles.count} aria-hidden="true">
        {answered} / {total}
      </span>
    </div>
  );
}
