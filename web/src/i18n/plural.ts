const rules = new Intl.PluralRules('ru');

/** Russian plural form for an integer: 1 слово, 2 слова, 5 слов. */
export function plural(count: number, forms: { one: string; few: string; many: string }): string {
  const rule = rules.select(count);
  return rule === 'one' ? forms.one : rule === 'few' ? forms.few : forms.many;
}

/** "Days" after «из N»: the genitive, so 1 дня but 2, 4 and 5 дней («3 из 4 дней»). */
export const daysAfterOf = (count: number) => plural(count, { one: 'дня', few: 'дней', many: 'дней' });

/** 1 неделя, 2 недели, 5 недель. */
export const weeksWord = (count: number) => plural(count, { one: 'неделя', few: 'недели', many: 'недель' });
