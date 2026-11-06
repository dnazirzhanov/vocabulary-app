import { t } from '../i18n/index.ts';
const short: Record<string, string> = { noun: t.n, verb: t.v, adjective: t.adj, adverb: t.adv };
const full: Record<string, string> = {
  noun: t.noun,
  verb: t.verb,
  adjective: t.adjective,
  adverb: t.adverb,
};

export const partOfSpeech = (pos: string) => ({ short: short[pos] ?? pos, full: full[pos] ?? pos });
