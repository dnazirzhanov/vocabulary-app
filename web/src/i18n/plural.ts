const rules = new Intl.PluralRules('ru');

/** Russian plural form for an integer: 1 слово, 2 слова, 5 слов. */
export function plural(count: number, forms: { one: string; few: string; many: string }): string {
  const rule = rules.select(count);
  return rule === 'one' ? forms.one : rule === 'few' ? forms.few : forms.many;
}
