import styles from './LessonProgress.module.css';
import { t } from '../i18n/index.ts';

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
        aria-label={t.lessonProgress}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={answered}
        aria-valuetext={t.of(answered, total)}
      >
        <div className={styles.fill} style={{ width: `${(answered / total) * 100}%` }} />
      </div>
      <span className={styles.count} aria-hidden="true">
        {answered} / {total}
      </span>
    </div>
  );
}
