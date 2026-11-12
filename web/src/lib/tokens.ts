/** Example sentences split into words and the text between them, so each word can be tapped.
 * Must match TOKEN in backend/app/services/content.py. */
const TOKEN = /[A-Za-zÀ-ÿ]+(?:'[A-Za-zÀ-ÿ]+)?/g;

export type Part = { text: string; key: string | null };

export function tokenize(sentence: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const match of sentence.matchAll(TOKEN)) {
    if (match.index > last) parts.push({ text: sentence.slice(last, match.index), key: null });
    parts.push({ text: match[0], key: match[0].toLowerCase() });
    last = match.index + match[0].length;
  }
  if (last < sentence.length) parts.push({ text: sentence.slice(last), key: null });
  return parts;
}

/** The audio file name of a glossary form: lowercase letters only ("can't" → "cant"). */
export const glossarySlug = (form: string) => form.toLowerCase().replace(/[^a-z0-9à-ÿ]+/g, '');

/** Words as the server counts an answer (`count_words` in backend/app/services/reading_answers.py). */
export const countWords = (text: string) => tokenize(text).filter((part) => part.key).length;
