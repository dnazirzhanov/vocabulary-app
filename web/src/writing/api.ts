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
  /** IELTS Task 2 type (ADR 0081); null for the retired general questions. */
  task_type?: TaskType | null;
}

export type TaskType = 'opinion' | 'discussion' | 'problem_solution' | 'advantages' | 'two_part';

export type CriterionName = 'task' | 'organization' | 'vocabulary' | 'grammar' | 'mechanics';
export const CRITERIA: CriterionName[] = ['task', 'organization', 'vocabulary', 'grammar', 'mechanics'];

export interface Mistake {
  original: string;
  corrected: string;
  explanation: string;
  type: 'grammar' | 'spelling' | 'punctuation' | 'word_choice';
}

/** The general 1–5 rubric (ADR 0068): answers marked before IELTS keep it. */
export interface GeneralEvaluation {
  rubric?: 'general';
  enough_evidence: boolean;
  cefr_level: string | null;
  criteria: Record<CriterionName, { score: number; comment: string }> | null;
  summary: string;
  strengths: { point: string; quote: string | null }[];
  improvements: string[];
  corrections: Mistake[];
  vocabulary: { original: string; suggestion: string; note: string }[];
  overall: number | null;
}

/** IELTS Task 2 (ADR 0081): four criteria with whole bands; the overall band is the server's. */
export type IeltsCriterionName =
  'task_response' | 'coherence_cohesion' | 'lexical_resource' | 'grammatical_range_accuracy';
export const IELTS_CRITERIA: IeltsCriterionName[] = [
  'task_response',
  'coherence_cohesion',
  'lexical_resource',
  'grammatical_range_accuracy',
];

export interface Upgrade {
  original: string;
  suggestion: string;
  note: string;
}

export interface IeltsEvaluation {
  rubric: 'ielts';
  enough_evidence: boolean;
  criteria: Record<IeltsCriterionName, { band: number; why: string; next_band: string }> | null;
  summary: string;
  corrections: Mistake[];
  upgrades: Upgrade[];
  band: number | null;
  words: number;
}

export type Evaluation = GeneralEvaluation | IeltsEvaluation;

export const isIelts = (ev: Evaluation): ev is IeltsEvaluation => ev.rubric === 'ielts';
/** The essay length an IELTS Task 2 asks for; here only said, never penalised (ADR 0081). */
export const IELTS_WORDS = 250;

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
  cefr_level: string | null;
  /** The IELTS overall band; null for answers on the general rubric. */
  band?: number | null;
  word_count: number;
  excerpt: string;
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
