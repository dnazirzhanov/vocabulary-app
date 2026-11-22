import { t } from '../i18n/index.ts';
import type { CriterionName, IeltsCriterionName, SubmissionSummary, TaskType } from './api.ts';

/** What a 1–5 mark is called. The same scale for the whole answer and for each criterion. */
export const scoreLabel = (score: number): string =>
  [t.writingScore1, t.writingScore2, t.writingScore3, t.writingScore4, t.writingScore5][
    Math.min(5, Math.max(1, score)) - 1
  ];

export const criterionLabel = (name: CriterionName): string =>
  ({
    task: t.writingCriterionTask,
    organization: t.writingCriterionOrganization,
    vocabulary: t.writingCriterionVocabulary,
    grammar: t.writingCriterionGrammar,
    mechanics: t.writingCriterionMechanics,
  })[name];

// --- IELTS (ADR 0081) ----------------------------------------------------------------------

/** A band as IELTS writes it: 6, 6.5, 7. */
export const bandText = (band: number): string => (Number.isInteger(band) ? String(band) : band.toFixed(1));

/** The criterion's name in full, for the tabs. */
export const ieltsLabel = (name: IeltsCriterionName): string =>
  ({
    task_response: t.writingIeltsTr,
    coherence_cohesion: t.writingIeltsCc,
    lexical_resource: t.writingIeltsLr,
    grammatical_range_accuracy: t.writingIeltsGra,
  })[name];

/** Its exam abbreviation, for the chips: TR, CC, LR, GRA. */
export const ieltsShort = (name: IeltsCriterionName): string =>
  ({ task_response: 'TR', coherence_cohesion: 'CC', lexical_resource: 'LR', grammatical_range_accuracy: 'GRA' })[name];

export const taskTypeLabel = (type: TaskType): string =>
  ({
    opinion: t.writingTypeOpinion,
    discussion: t.writingTypeDiscussion,
    problem_solution: t.writingTypeProblem,
    advantages: t.writingTypeAdvantages,
    two_part: t.writingTypeTwoPart,
  })[type];

/** How a past essay was marked, in a few characters: «IELTS 6.5», or the 1–5 label; null if not. */
export function markOf(item: Pick<SubmissionSummary, 'status' | 'band' | 'overall'>): string | null {
  if (item.status !== 'done') return null;
  if (item.band !== null && item.band !== undefined) return `IELTS ${bandText(item.band)}`;
  return item.overall ? `${scoreLabel(item.overall)} · ${t.writingScoreOutOf(item.overall)}` : null;
}
