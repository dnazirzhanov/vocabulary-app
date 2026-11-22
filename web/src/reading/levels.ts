/** Reading Mode's level labels, kept here so pure modules can import them without pulling in
 *  the whole reading feature. */

export type Level = 'A1' | 'A2' | 'B1' | 'B2' | 'C1';
export const LEVELS: readonly Level[] = ['A1', 'A2', 'B1', 'B2', 'C1'];
