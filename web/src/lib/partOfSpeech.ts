const short: Record<string, string> = { noun: 'сущ.', verb: 'гл.', adjective: 'прил.', adverb: 'нар.' };
const full: Record<string, string> = {
  noun: 'существительное',
  verb: 'глагол',
  adjective: 'прилагательное',
  adverb: 'наречие',
};

export const partOfSpeech = (pos: string) => ({ short: short[pos] ?? pos, full: full[pos] ?? pos });
