/** A group's spelling tests (ADR 0046): what the screens say about them, and the running clock. */
import type { TestScore } from './types.ts';

/** Whole seconds until a deadline, never below zero. */
export function secondsLeft(deadline: string, now: Date): number {
  return Math.max(0, Math.ceil((Date.parse(deadline) - now.getTime()) / 1000));
}

/** «9:05» */
export function clockText(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export const scoreText = (score: Pick<TestScore, 'correct' | 'total'>): string => `${score.correct} из ${score.total}`;

export const verdictText = (passed: boolean): string => (passed ? 'Сдано' : 'Не сдано');

export interface RunningTest {
  groupId: string;
  deckId: string;
  attemptId: string;
}

// The app has no router, so this is what brings a reload back to the test; the order, the answers
// and the deadline all come from the server.
const RUNNING_KEY = 'runningTest';

export function rememberRunningTest(running: RunningTest): void {
  try {
    sessionStorage.setItem(RUNNING_KEY, JSON.stringify(running));
  } catch {
    // storage unavailable: a reload goes home, and the test's page offers to continue
  }
}

export function runningTest(): RunningTest | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(RUNNING_KEY) ?? 'null') as Partial<RunningTest> | null;
    return stored?.groupId && stored.deckId && stored.attemptId
      ? { groupId: stored.groupId, deckId: stored.deckId, attemptId: stored.attemptId }
      : null;
  } catch {
    return null;
  }
}

export function forgetRunningTest(): void {
  try {
    sessionStorage.removeItem(RUNNING_KEY);
  } catch {
    // nothing stored
  }
}
