/** Typed client for the Writing HTTP API. Same plumbing as Speaking's: its own `request`. */

import { accessToken } from '../lib/auth.ts';
import { ApiError } from '../lib/apiError.ts';
import { apiBase } from '../lib/platform.ts';
import { uiLanguage } from '../i18n/index.ts';

export interface Topic {
  topic: string;
  question_count: number;
}

export interface WritingQuestion {
  id: string;
  topic: string;
  title: string;
  instruction: string;
  level: string | null;
  suggested_minutes: number | null;
}

export type CriterionName = 'task' | 'organization' | 'vocabulary' | 'grammar' | 'mechanics';
export const CRITERIA: CriterionName[] = ['task', 'organization', 'vocabulary', 'grammar', 'mechanics'];

export interface Mistake {
  original: string;
  corrected: string;
  explanation: string;
  type: 'grammar' | 'spelling' | 'punctuation' | 'word_choice';
}

export interface Evaluation {
  enough_evidence: boolean;
  cefr_level: string | null;
  criteria: Record<CriterionName, { score: number; comment: string }> | null;
  summary: string;
  strengths: { point: string; quote: string | null }[];
  improvements: string[];
  corrections: Mistake[];
  vocabulary: { original: string; suggestion: string; note: string }[];
  improved_version: string;
  overall: number | null;
}

export type SubmissionStatus = 'pending' | 'done' | 'failed';

export interface Submission {
  id: string;
  question_id: string;
  question: WritingQuestion | null;
  answer: string;
  time_spent_seconds: number | null;
  status: SubmissionStatus;
  failure_code: string | null;
  evaluation: Evaluation | null;
  created_at: string;
}

export interface SubmissionSummary {
  id: string;
  question_id: string;
  question_title: string;
  status: SubmissionStatus;
  overall: number | null;
  created_at: string;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = await accessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network', 0, 'network', 'No connection');
  }
  if (!response.ok) {
    let code = 'http_error';
    let message = response.statusText;
    try {
      const data = (await response.json()) as { error?: { code?: string; message?: string } };
      code = data.error?.code ?? code;
      message = data.error?.message ?? message;
    } catch {
      // not JSON
    }
    throw new ApiError('http', response.status, code, message);
  }
  return (await response.json()) as T;
}

export const listTopics = () => request<Topic[]>('GET', '/writing/topics');

export const listQuestions = (topic: string) =>
  request<WritingQuestion[]>('GET', `/writing/questions?topic=${encodeURIComponent(topic)}`);

export const listSubmissions = () => request<SubmissionSummary[]>('GET', '/writing/submissions');

export const getSubmission = (id: string) => request<Submission>('GET', `/writing/submissions/${id}`);

export function submitAnswer(input: {
  clientId: string;
  questionId: string;
  answer: string;
  timeSpentSeconds: number | null;
}): Promise<Submission> {
  return request<Submission>('POST', '/writing/submissions', {
    client_id: input.clientId,
    question_id: input.questionId,
    answer: input.answer,
    time_spent_seconds: input.timeSpentSeconds,
    feedback_language: uiLanguage,
  });
}
