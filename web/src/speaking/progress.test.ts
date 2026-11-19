import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SessionSummary } from './api.ts';
import { overallSeries, skillTrend } from './progress.ts';

const attempt = (day: number, overall: number | null, fluency: number | null = overall, status = 'done') =>
  ({
    id: `a${day}`,
    question_id: 'q',
    exercise_type: 'spontaneous',
    status,
    started_at: `2026-11-${String(day).padStart(2, '0')}T10:00:00Z`,
    completed_at: null,
    duration_ms: 60_000,
    has_audio: true,
    overall_score: overall,
    pronunciation_score: null,
    fluency_score: fluency,
    vocabulary_score: null,
    grammar_score: null,
    coherence_score: null,
  }) as SessionSummary;

test('the overall line is oldest first and skips unfinished or unscored attempts', () => {
  const series = overallSeries([attempt(3, 70), attempt(1, 50), attempt(2, null), attempt(4, 90, 90, 'processing')]);
  assert.deepEqual(
    series.map((p) => p.score),
    [50, 70],
  );
});

test('one answer has a level but no change yet', () => {
  assert.deepEqual(skillTrend([attempt(1, 61.4)], 'fluency'), { now: 61, change: null });
  assert.equal(skillTrend([attempt(1, 61)], 'grammar'), null);
});

test('two answers compare the latest with the first', () => {
  assert.deepEqual(skillTrend([attempt(2, 70), attempt(1, 50)], 'fluency'), { now: 70, change: 20 });
});

test('with many answers the latest three are compared with the first three', () => {
  const scores = [40, 50, 60, 55, 70, 80, 90];
  const trend = skillTrend(
    scores.map((s, i) => attempt(i + 1, s)),
    'fluency',
  );
  assert.deepEqual(trend, { now: 80, change: 30 }); // (70+80+90)/3 − (40+50+60)/3
});

test('a drop is a negative change', () => {
  assert.deepEqual(skillTrend([attempt(1, 80), attempt(2, 65)], 'fluency'), { now: 65, change: -15 });
});
