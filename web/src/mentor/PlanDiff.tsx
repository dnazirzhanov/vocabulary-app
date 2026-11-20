/**
 * A change to the day, shown as before → after (ADR 0074): what the plan was and what it becomes,
 * so a learner never has to work out what a change did. Used by «Сегодня не получается» and by
 * the mentor's cards.
 */
import { t } from '../i18n/index.ts';
import { hhmm } from './chat/format.ts';
import type { Line } from './rescue.ts';
import styles from './PlanDiff.module.css';

function List({ lines, struck }: { lines: Line[]; struck?: boolean }) {
  if (lines.length === 0) return <p className={styles.nothing}>{t.mentorRescueNothing}</p>;
  return (
    <ul className={styles.lines}>
      {lines.map((line, i) => (
        <li key={i} data-struck={struck || undefined}>
          <span className={styles.time}>{line.at === null ? '—' : hhmm(line.at)}</span>
          <span className={styles.title}>{line.title}</span>
          <span className={styles.minutes}>{t.mentorMinutesShort(line.minutes)}</span>
        </li>
      ))}
    </ul>
  );
}

export function PlanDiff({ before, after }: { before: Line[]; after: Line[] }) {
  return (
    <div className={styles.diff}>
      <div>
        <p className={styles.label}>{t.mentorRescueBefore}</p>
        <List lines={before} struck />
      </div>
      <span className={styles.arrow} aria-hidden="true">
        →
      </span>
      <div>
        <p className={styles.label}>{t.mentorRescueAfter}</p>
        <List lines={after} />
      </div>
    </div>
  );
}
