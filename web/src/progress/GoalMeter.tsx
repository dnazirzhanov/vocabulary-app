import { plural } from '../i18n/plural.ts';
import styles from './GoalMeter.module.css';

const points = (n: number) => `${n}\u00a0${plural(n, { one: 'очко', few: 'очка', many: 'очков' })}`;

/** Today's points against the daily goal: a meter, not a chart (one ratio against a limit). */
export function GoalMeter({ value, goal }: { value: number; goal: number }) {
  const met = value >= goal;
  return (
    <div className={styles.meter}>
      <div className={styles.head}>
        <span className={styles.label} id="goal-label">
          Цель на сегодня
        </span>
        <span className={styles.value}>
          <strong>{value}</strong> / {points(goal)}
        </span>
      </div>
      <div
        className={styles.track}
        role="meter"
        aria-labelledby="goal-label"
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-valuenow={Math.min(value, goal)}
        aria-valuetext={`${points(value)} из ${goal}`}
      >
        <div className={styles.fill} style={{ width: `${Math.min(value / goal, 1) * 100}%` }} />
      </div>
      <p className={styles.note} data-met={met || undefined}>
        {met ? 'Цель выполнена — так держать.' : `До цели ${points(goal - value)}.`}
      </p>
    </div>
  );
}
