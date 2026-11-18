import { t } from '../i18n/index.ts';
import type { CriterionName } from './api.ts';

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
