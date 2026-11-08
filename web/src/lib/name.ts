import { t } from '../i18n/index.ts';

/** The longest name the server keeps (ADR 0057). */
export const NAME_MAX = 20;

/**
 * Why a typed name would be refused, or null if it is fine. Mirrors the server's rules
 * (`services/names.py`): letters of any language, digits, spaces, hyphens, apostrophes, and a dot
 * only at the end of a word («Анна К.»), so no e-mail, link or phone number fits.
 */
export function nameProblem(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 2) return t.atLeast2Characters;
  if (name.length > NAME_MAX) return t.atMost20Characters;
  if (!/^[\p{L}\p{Nd} '‘’.-]+$/u.test(name) || /\.\S/.test(name) || name.startsWith('.')) {
    return t.onlyLettersDigitsSpacesAndHyphens;
  }
  const digits = (name.match(/\d/g) ?? []).length;
  if (digits >= 5 || digits === name.replace(/[ '‘’.-]/g, '').length) return t.aNameCanTBeA;
  if (/https?|www/i.test(name)) return t.noLinks;
  return null;
}
