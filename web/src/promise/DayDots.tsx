import { dotsLabel, WEEKDAY_NAMES } from '../lib/promise.ts';
import type { DayState } from '../lib/types.ts';
import { CheckIcon } from '../ui/icons.tsx';
import styles from './DayDots.module.css';

/**
 * A member's week against their promise (ADR 0039): seven dots, Monday first. Shapes differ as well
 * as colours — a ✓ for done, an empty ring for a missed day, a ringed ring for today, a faint ring
 * for a day to come, a small dot for a day off — and nothing is red.
 */
export function DayDots({ states, named = false }: { states: DayState[]; named?: boolean }) {
  return (
    <ol className={styles.dots} role="img" aria-label={dotsLabel(states)} data-named={named || undefined}>
      {states.map((state, weekday) => (
        <li key={WEEKDAY_NAMES[weekday]} data-state={state}>
          <span className={styles.dot}>{state === 'done' && <CheckIcon aria-hidden="true" />}</span>
          {named && (
            <span className={styles.name} aria-hidden="true">
              {WEEKDAY_NAMES[weekday]}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
