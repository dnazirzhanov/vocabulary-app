/**
 * A deck's words in plain stages (ADR 0034): «знаю» (recalled a day or more later), «учу» (met,
 * still settling), «впереди» (not met yet). The parts at zero are left out.
 */
export function deckStages({ word_count, met, learned }: { word_count: number; met: number; learned: number }): string {
  const parts: [string, number][] = [
    ['знаю', learned],
    ['учу', Math.max(0, met - learned)],
    ['впереди', Math.max(0, word_count - met)],
  ];
  return parts
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label} ${count}`)
    .join(' · ');
}
