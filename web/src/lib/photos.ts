import { t } from '../i18n/index.ts';

/**
 * Photos of lesson material (ADR 0029): up to 4 at a time, 8 per deck in all. The text is read
 * from them in the browser (lib/ocr.ts); only the text is sent to draft cards.
 */
export const MAX_PHOTOS_PER_DRAFT = 4;
export const MAX_PHOTOS_PER_DECK = 8;
/** Less text than this from a photo is likely nothing readable. */
export const MIN_PHOTO_TEXT = 20;

const photosOf = (n: number) => t.photosCount(n);

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
          ? t.noMorePhotosCanBeAdded(MAX_PHOTOS_PER_DECK)
          : t.atMostAtATimePick(photosOf(MAX_PHOTOS_PER_DRAFT)),
    };
  const limit =
    room < MAX_PHOTOS_PER_DRAFT - inDraft
      ? t.leftForThisDeck(photosOf(deckLeft - inDraft))
      : t.atMostAtATime(photosOf(MAX_PHOTOS_PER_DRAFT));
  return { take, note: t.tookTheFirst(photosOf(take), limit) };
}

/** Text read from a photo, tidied: words split across lines joined, blank runs shortened. */
export function tidyPhotoText(text: string): string {
  return text
    .replace(/(\w)-\n(\w)/g, '$1$2')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
