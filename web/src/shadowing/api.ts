import { accessToken } from '../lib/auth.ts';
import { apiBase } from '../lib/platform.ts';

async function authHeaders(): Promise<Record<string, string>> {
  const token = await accessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface ShadowingSentence {
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface ShadowingExercise {
  id: string;
  slug: string;
  title: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  language: string;
  duration_ms: number;
  transcript: string;
  sentences: ShadowingSentence[];
  speaker: string | null;
  has_audio: boolean;
  display_order: number;
}

export interface ShadowingAttempt {
  id: string;
  exercise_id: string;
  duration_ms: number | null;
  completed_at: string | null;
  created_at: string;
}

export interface ExerciseStatus {
  exercise_id: string;
  attempts_count: number;
  completed_count: number;
  last_attempted_at: string | null;
}

export interface AttemptListItem {
  id: string;
  duration_ms: number | null;
  completed_at: string | null;
  created_at: string;
  has_audio: boolean;
}

export async function listExercises(): Promise<ShadowingExercise[]> {
  const headers = await authHeaders();
  const res = await fetch(`${apiBase}/shadowing/exercises`, { headers });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export function getExerciseAudioUrl(exerciseId: string): string {
  return `${apiBase}/shadowing/exercises/${exerciseId}/audio`;
}

export async function createAttempt(exerciseId: string): Promise<ShadowingAttempt> {
  const headers = await authHeaders();
  const res = await fetch(`${apiBase}/shadowing/attempts`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ exercise_id: exerciseId }),
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/** A file name whose extension matches what the browser recorded (Safari records MP4, not WebM). */
export function recordingFileName(mimeType: string): string {
  const base = mimeType.split(';', 1)[0].trim();
  const ext = base === 'audio/mp4' ? 'm4a' : base === 'audio/ogg' ? 'ogg' : 'webm';
  return `recording.${ext}`;
}

export async function uploadAttemptAudio(
  attemptId: string,
  blob: Blob,
  mimeType: string,
  durationMs: number | null,
): Promise<ShadowingAttempt> {
  const headers = await authHeaders();
  const form = new FormData();
  form.append('file', new Blob([blob], { type: mimeType }), recordingFileName(mimeType));
  if (durationMs != null) form.append('duration_ms', String(durationMs));
  const res = await fetch(`${apiBase}/shadowing/attempts/${attemptId}/audio`, {
    method: 'POST',
    headers,
    body: form,
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export async function getAttemptAudioUrl(attemptId: string): Promise<string> {
  const headers = await authHeaders();
  const res = await fetch(`${apiBase}/shadowing/attempts/${attemptId}/audio`, {
    headers,
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export async function completeAttempt(attemptId: string): Promise<ShadowingAttempt> {
  const headers = await authHeaders();
  const res = await fetch(`${apiBase}/shadowing/attempts/${attemptId}/complete`, {
    method: 'POST',
    headers,
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export async function getExerciseAttempts(exerciseId: string): Promise<ExerciseStatus> {
  const headers = await authHeaders();
  const res = await fetch(`${apiBase}/shadowing/exercises/${exerciseId}/attempts`, {
    headers,
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

export async function listMyAttempts(exerciseId: string): Promise<AttemptListItem[]> {
  const headers = await authHeaders();
  const res = await fetch(`${apiBase}/shadowing/exercises/${exerciseId}/my-attempts`, {
    headers,
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/**
 * Save a finished shadowing: the attempt is created only now, so cancelling or trying again
 * never leaves an empty attempt behind.
 */
export async function saveAttempt(
  exerciseId: string,
  recording: { blob: Blob; mimeType: string; durationMs: number },
): Promise<ShadowingAttempt> {
  const attempt = await createAttempt(exerciseId);
  await uploadAttemptAudio(attempt.id, recording.blob, recording.mimeType, Math.round(recording.durationMs));
  return completeAttempt(attempt.id);
}
