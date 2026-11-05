/**
 * Letter tiles (ADR 0016): the learner picks tiles into the answer slots. A tile is known by its
 * position in the bank, so two `p` tiles stay two separate tiles; a picked tile leaves an empty
 * place in the bank and returns to it when removed. Pure functions: the screen holds the state.
 */

/** Picked tile positions, in answer order. */
export type Picked = number[];

/** Puts a tile in the next empty slot, if there is one and the tile is still in the bank. */
export function pick(picked: Picked, tile: number, slots: number): Picked {
  if (picked.length >= slots || picked.includes(tile)) return picked;
  return [...picked, tile];
}

/** Takes the letter in `slot` out; the letters after it move left. */
export const removeAt = (picked: Picked, slot: number): Picked => picked.filter((_, index) => index !== slot);

export const backspace = (picked: Picked): Picked => picked.slice(0, -1);

export const answerOf = (tiles: string[], picked: Picked): string => picked.map((tile) => tiles[tile]).join('');

/** A phrase's slots split into its words at the spaces, so a line never breaks inside a word. */
export function slotWords(slots: number, separators: { after: number; char: string }[]): number[][] {
  const starts = new Set(separators.filter((s) => s.char === ' ').map((s) => s.after));
  const words: number[][] = [[]];
  for (let slot = 0; slot < slots; slot += 1) {
    if (starts.has(slot) && slot > 0) words.push([]);
    words[words.length - 1].push(slot);
  }
  return words;
}

/** The built letters with a phrase's fixed spaces, hyphens and apostrophes put back in. */
export function withSeparators(letters: string, separators: { after: number; char: string }[]): string {
  let built = '';
  let next = 0;
  [...letters].forEach((letter, index) => {
    while (next < separators.length && separators[next].after === index) built += separators[next++].char;
    built += letter;
  });
  return built;
}

/** A typed letter picks the first tile with it still in the bank (repeated letters too). */
export function tileForKey(tiles: string[], picked: Picked, key: string): number | null {
  const letter = key.toLowerCase();
  if (!/^[a-z]$/.test(letter)) return null;
  const index = tiles.findIndex((tile, position) => tile === letter && !picked.includes(position));
  return index === -1 ? null : index;
}

/** Letter by letter, which ones differ from the word (the feedback marks them; not colour alone). */
export function differences(answer: string, target: string): { letter: string; differs: boolean }[] {
  return [...answer].map((letter, index) => ({ letter, differs: letter !== target[index] }));
}

/** Keeps a half-built answer across a reload; storage may be unavailable (private mode). */
export function savedPicks(key: string): Picked {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(key) ?? '[]');
    return Array.isArray(stored) && stored.every((value) => Number.isInteger(value)) ? (stored as Picked) : [];
  } catch {
    return [];
  }
}

/** Whether this card's word was listened to, so a reload doesn't make it look spelled from memory. */
export function savedHeard(key: string): boolean {
  try {
    return sessionStorage.getItem(`${key}:heard`) !== null;
  } catch {
    return false;
  }
}

export function saveHeard(key: string): void {
  try {
    sessionStorage.setItem(`${key}:heard`, '1');
  } catch {
    // storage unavailable: it is still known until a reload
  }
}

export function savePicks(key: string, picked: Picked): void {
  try {
    if (picked.length) sessionStorage.setItem(key, JSON.stringify(picked));
    else sessionStorage.removeItem(key);
  } catch {
    // storage unavailable: the half-built answer is simply not kept
  }
}
