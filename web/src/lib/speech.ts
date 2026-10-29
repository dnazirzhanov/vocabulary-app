/** Pronunciation through the browser's own voices; hidden where the browser has none. */
export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

export function speak(word: string) {
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = 'en-US';
  utterance.rate = 0.9;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}
