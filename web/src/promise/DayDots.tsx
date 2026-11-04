import { dotsLabel, WEEKDAY_NAMES } from '../lib/promise.ts';
import type { DayState, TodayState } from '../lib/types.ts';
import { CheckIcon } from '../ui/icons.tsx';
import styles from './DayDots.module.css';

/**
 * A member's week against their promise (ADR 0039): seven dots, Monday first, each under its
 * weekday, filling the width it is given. The promised days are the ones that are not a small dot.
 * Shapes differ as well as colours — a ✓ for done, an empty ring for a missed day, a ringed ring for today, a faint ring
 * for a day to come, a small dot for a day off — and nothing is red.
 */
export function DayDots({ states }: { states: DayState[] }) {
  return (
    <ol className={styles.dots} role="img" aria-label={dotsLabel(states)}>
      {states.map((state, weekday) => (
        <li key={WEEKDAY_NAMES[weekday]} data-state={state}>
          <span className={styles.dot}>{state === 'done' && <CheckIcon aria-hidden="true" />}</span>
          <span className={styles.name} aria-hidden="true">
            {WEEKDAY_NAMES[weekday]}
          </span>
        </li>
      ))}
    </ol>
  );
}

const MARK: Record<TodayState, DayState> = { done: 'done', pending: 'today', off: 'off' };

/**
 * One dot of the same language, for a heading of today's lists: a ✓ for those who did it, a
 * ringed ring for those who haven't yet, a small dot for a day off. It repeats what the week of
 * dots says in a friend's window, so the marks are learned once.
 */
export function StateMark({ state }: { state: TodayState }) {
  return (
    <span className={styles.mark} data-state={MARK[state]} aria-hidden="true">
      <span className={styles.dot}>{state === 'done' && <CheckIcon />}</span>
    </span>
  );
}
