/**
 * How a learner's speaking is changing, from their scored attempts. One answer is noisy (a hard
 * question, a bad day), so a skill's "now" is the mean of the latest few answers and its change is
 * measured against the mean of the first few; the two groups never overlap.
 */
import type { SessionSummary } from './api.ts';

export type Skill = 'pronunciation' | 'fluency' | 'vocabulary' | 'grammar' | 'coherence';

export interface Point {
  id: string;
  at: string;
  score: number;
}

/** Overall scores of finished attempts, oldest first. */
export function overallSeries(attempts: SessionSummary[]): Point[] {
  return attempts
    .filter((a) => a.status === 'done' && a.overall_score !== null)
    .map((a) => ({ id: a.id, at: a.started_at, score: a.overall_score as number }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

export interface Trend {
  /** Mean of the latest answers, rounded. */
  now: number;
  /** Change since the first answers, rounded; null with a single answer. */
  change: number | null;
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

export function skillTrend(attempts: SessionSummary[], skill: Skill): Trend | null {
  const scores = attempts
    .filter((a) => a.status === 'done' && a[`${skill}_score`] !== null)
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
    .map((a) => a[`${skill}_score`] as number);
  if (scores.length === 0) return null;
  if (scores.length === 1) return { now: Math.round(scores[0]), change: null };
  const window = Math.min(3, Math.floor(scores.length / 2));
  const now = mean(scores.slice(-window));
  const then = mean(scores.slice(0, window));
  return { now: Math.round(now), change: Math.round(now - then) };
}
