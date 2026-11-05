import { useEffect, useReducer } from 'react';
import { secondsLeft } from '../lib/groupTests.ts';
import { serverNow } from '../lib/clock.ts';

/** Seconds to a deadline by the server's clock, not the phone's; null without a deadline. */
export function useSecondsLeft(deadline: string | null): number | null {
  const [, tick] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  return deadline ? secondsLeft(deadline, serverNow()) : null;
}
