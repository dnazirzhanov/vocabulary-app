import { request } from '../lib/api.ts';
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
  /** ADR 0097: a YouTube exercise plays in YouTube's player; its sentences' times are the video's. */
  source: 'file' | 'youtube';
  youtube_id: string | null;
  clip_start_ms: number | null;
  clip_end_ms: number | null;
  thumbnail_url: string | null;
  /** Made by me (I may change or remove it). */
  mine: boolean;
}

export interface YouTubeVideo {
  youtube_id: string;
  title: string;
  author: string;
  thumbnail_url: string;
}

export interface NewYouTubeExercise {
  youtube_id: string;
  title: string;
  author: string;
  difficulty: ShadowingExercise['difficulty'];
  clip_start_ms: number;
  clip_end_ms: number;
  sentences: ShadowingSentence[];
}

/** Whether YouTube's player may show this video here (public, embedding allowed), with its title. */
export const checkYouTube = (url: string) => request<YouTubeVideo>('POST', '/shadowing/youtube/check', { url });

export interface YouTubeTranscript {
  /** 'manual': the channel's own subtitles; 'auto': YouTube's speech recognition. */
  kind: 'manual' | 'auto';
  cues: { start_ms: number; end_ms: number; text: string }[];
}

/** The video's own captions, fetched by the server (ADR 0100); fails when there are none. */
export const fetchTranscript = (youtubeId: string) =>
  request<YouTubeTranscript>('POST', '/shadowing/youtube/transcript', { youtube_id: youtubeId }, 35_000, 0);

export const createYouTubeExercise = (body: NewYouTubeExercise) =>
  request<ShadowingExercise>('POST', '/shadowing/exercises', body);

export const removeExercise = (id: string) => request<null>('DELETE', `/shadowing/exercises/${id}`);

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
