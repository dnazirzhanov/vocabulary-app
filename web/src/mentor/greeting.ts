import type { GreetingPhase } from './types.ts';

/** Which part of the day a wall-clock hour belongs to. Pure. */
export function phaseFor(hour: number): GreetingPhase {
  if (hour < 5) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'night';
}
