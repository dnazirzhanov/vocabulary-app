/**
 * Typed client for the Speaking HTTP API (Chunk 2).
 *
 * Follows the project's `request<T>` convention from `web/src/lib/api.ts`. The audio upload goes
 * through its own fetch call because `request` doesn't know about multipart bodies — we still go
 * through the same base URL + auth header infra from `lib/api.ts`.
 */

import { accessToken } from '../lib/auth.ts';
import { apiBase } from '../lib/platform.ts';

async function authHeaders(): Promise<Record<string, string>> {
  const token = await accessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type ExerciseType = 'spontaneous' | 'pronunciation';
export type SessionStatus = 'created' | 'uploaded' | 'processing' | 'done' | 'failed';

export interface SpeakingQuestion {
  id: string;
  exercise_type: ExerciseType;
  text: string;
  topic: string;
  level?: string | null;
  reference_text?: string | null;
}

export interface SessionSummary {
  id: string;
  question_id: string;
  status: SessionStatus;
  started_at: string;
  completed_at: string | null;
  overall_score: number | null;
  pronunciation_score: number | null;
  fluency_score: number | null;
  vocabulary_score: number | null;
  grammar_score: number | null;
  coherence_score: number | null;
}

export interface SpeakingSession {
  id: string;
  exercise_type: ExerciseType;
  question_id: string;
  status: SessionStatus;
  failure_reason: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface SpeakingAudioAsset {
  mime_type: string;
  byte_size: number;
  duration_ms: number | null;
  sample_rate: number | null;
  uploaded_at: string;
}

export interface PhonemeScore {
  phoneme: string;
  accuracy_score: number;
}

export interface PronunciationWord {
  word: string;
  accuracy_score: number;
  error_type: string;
  phonemes: PhonemeScore[];
}

export interface TranscriptWord {
  word: string;
  start_ms: number;
  end_ms: number;
  confidence: number;
}

export interface FeedbackItem {
  category: 'pronunciation' | 'grammar' | 'vocabulary' | 'coherence' | 'fluency';
  severity: 'major' | 'minor' | 'info';
  original_text: string | null;
  corrected_text: string | null;
  explanation: string | null;
}

export interface SpeakingAssessment {
  id: string;
  transcript: string;
  transcript_words: TranscriptWord[];
  pronunciation_score: number | null;
  fluency_score: number | null;
  vocabulary_score: number | null;
  grammar_score: number | null;
  coherence_score: number | null;
  overall_score: number | null;
  pronunciation_words: PronunciationWord[];
  feedback_items: FeedbackItem[];
  evidence: Record<string, unknown>;
  created_at: string;
}

export interface SpeakingSessionDetail extends SpeakingSession {
  audio: SpeakingAudioAsset | null;
  assessment: SpeakingAssessment | null;
}

export class SpeakingApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'SpeakingApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  Object.assign(headers, await authHeaders());
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function toApiError(response: Response): Promise<SpeakingApiError> {
  let code = 'http_error';
  let message = response.statusText;
  try {
    const data = (await response.json()) as { error?: { code?: string; message?: string } };
    if (data.error?.code) code = data.error.code;
    if (data.error?.message) message = data.error.message;
  } catch {
    // body wasn't JSON — fall through
  }
  return new SpeakingApiError(response.status, code, message);
}

export function listSessions(questionId?: string): Promise<SessionSummary[]> {
  const qs = questionId ? `?question_id=${encodeURIComponent(questionId)}` : '';
  return request<SessionSummary[]>('GET', `/speaking/sessions${qs}`);
}

export function listQuestions(exerciseType?: ExerciseType): Promise<SpeakingQuestion[]> {
  const qs = exerciseType ? `?exercise_type=${exerciseType}` : '';
  return request<SpeakingQuestion[]>('GET', `/speaking/questions${qs}`);
}

export function createSession(exerciseType: ExerciseType, questionId: string): Promise<SpeakingSession> {
  return request<SpeakingSession>('POST', '/speaking/sessions', {
    exercise_type: exerciseType,
    question_id: questionId,
  });
}

export function getSession(id: string): Promise<SpeakingSessionDetail> {
  return request<SpeakingSessionDetail>('GET', `/speaking/sessions/${id}`);
}

export function deleteSession(id: string): Promise<void> {
  return request<void>('DELETE', `/speaking/sessions/${id}`);
}

export async function uploadAudio(
  sessionId: string,
  blob: Blob,
  mimeType: string,
  durationMs: number,
  sampleRate: number | null,
): Promise<SpeakingSessionDetail> {
  const form = new FormData();
  // Explicit filename so the backend's `UploadFile.content_type` is used rather than
  // falling back to `application/octet-stream`.
  const extension = extensionFor(mimeType);
  form.append('file', new File([blob], `recording${extension}`, { type: mimeType }));
  form.append('duration_ms', String(Math.max(0, Math.round(durationMs))));
  if (sampleRate !== null) form.append('sample_rate', String(sampleRate));

  const headers: Record<string, string> = {};
  // Do NOT set Content-Type — the browser must add the multipart boundary itself.
  Object.assign(headers, await authHeaders());

  const response = await fetch(`${apiBase}/speaking/sessions/${sessionId}/audio`, {
    method: 'POST',
    headers,
    body: form,
  });
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as SpeakingSessionDetail;
}

function extensionFor(mimeType: string): string {
  const base = mimeType.split(';', 1)[0].trim();
  if (base === 'audio/webm') return '.webm';
  if (base === 'audio/ogg') return '.ogg';
  if (base === 'audio/mp4') return '.m4a';
  if (base === 'audio/mpeg') return '.mp3';
  if (base === 'audio/wav' || base === 'audio/x-wav') return '.wav';
  return '.bin';
}
