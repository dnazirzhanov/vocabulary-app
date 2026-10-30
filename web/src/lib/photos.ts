import { plural } from '../i18n/plural.ts';

/**
 * Photos of lesson material (ADR 0029): up to 4 at a time, 8 per deck in all. The text is read
 * from them in the browser (lib/ocr.ts); only the text is sent to draft cards.
 */
export const MAX_PHOTOS_PER_DRAFT = 4;
export const MAX_PHOTOS_PER_DECK = 8;
/** Less text than this from a photo is likely nothing readable. */
export const MIN_PHOTO_TEXT = 20;

const photosOf = (n: number) => `${n}\u00a0${plural(n, { one: 'фото', few: 'фото', many: 'фото' })}`;

/**
 * How many of the chosen photos to read: no more than 4 in one draft, counting those already
 * read into it, nor more than the deck has left. `note` says why some were left out.
 */
export function takePhotos(chosen: number, inDraft: number, deckLeft: number): { take: number; note: string | null } {
  const room = Math.max(0, Math.min(MAX_PHOTOS_PER_DRAFT - inDraft, deckLeft - inDraft));
  const take = Math.min(chosen, room);
  if (take === chosen) return { take, note: null };
  if (room === 0)
    return {
      take,
      note:
        deckLeft - inDraft <= 0
          ? `В эту колоду больше нельзя добавить фото: их уже ${MAX_PHOTOS_PER_DECK}. Вставьте текст вручную.`
          : `За один раз — не больше ${photosOf(MAX_PHOTOS_PER_DRAFT)}. Подберите слова, потом добавьте ещё.`,
    };
  const limit =
    room < MAX_PHOTOS_PER_DRAFT - inDraft
      ? `для этой колоды осталось ${photosOf(deckLeft - inDraft)}`
      : `за один раз — не больше ${photosOf(MAX_PHOTOS_PER_DRAFT)}`;
  return { take, note: `Взяли первые ${photosOf(take)}: ${limit}.` };
}

/** Text read from a photo, tidied: words split across lines joined, blank runs shortened. */
export function tidyPhotoText(text: string): string {
  return text
    .replace(/(\w)-\n(\w)/g, '$1$2')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
