/** The languages the app's text comes in (ADR 0055), each named in itself. */
export const UI_LANGUAGES = {
  ru: 'Русский',
  uz: 'O‘zbekcha',
  kk: 'Қазақша',
  ky: 'Кыргызча',
  tg: 'Тоҷикӣ',
  en: 'English',
} as const;

export type UiLanguage = keyof typeof UI_LANGUAGES;

/** What a card's meaning comes in. English is what's learned, so it isn't one of them. */
export const CARD_LANGUAGES = {
  ru: UI_LANGUAGES.ru,
  uz: UI_LANGUAGES.uz,
  kk: UI_LANGUAGES.kk,
  ky: UI_LANGUAGES.ky,
  tg: UI_LANGUAGES.tg,
} as const;

export type CardLanguage = keyof typeof CARD_LANGUAGES;

const known = (code: string | null | undefined): code is UiLanguage =>
  code != null && Object.hasOwn(UI_LANGUAGES, code);

/** A choice made earlier, or else the device's language if we have it, or else Russian. */
export function startingLanguage(saved: string | null, device: readonly string[]): UiLanguage {
  if (known(saved)) return saved;
  for (const tag of device) {
    const code = tag.toLowerCase().split('-')[0];
    if (known(code)) return code;
  }
  return 'ru';
}
