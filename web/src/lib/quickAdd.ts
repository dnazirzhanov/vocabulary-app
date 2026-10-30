/** Words as typed for quick adding (ADR 0019): one per line, or separated by commas or semicolons. */
export const wordsIn = (typed: string): string[] =>
  typed
    .split(/[\n,;]+/)
    .map((word) => word.trim())
    .filter(Boolean);
