/**
 * A deck's topics (ADR 0019): when is a typed topic one the deck already has, and when is it new
 * enough to offer a deck of its own? Case, «ё» and spacing don't count, and a topic that contains
 * an earlier one, or is contained in it, is the same topic («изменение климата» and «климат»).
 */
const normal = (topic: string) => topic.toLowerCase().replaceAll('ё', 'е').split(/\s+/).filter(Boolean).join(' ');

export function sameTopic(one: string, other: string): boolean {
  const a = normal(one);
  const b = normal(other);
  return a !== '' && b !== '' && (a === b || a.includes(b) || b.includes(a));
}

/** New for this deck: it has topics already, and this is none of them. */
export const isNewTopic = (topic: string, topics: string[]) =>
  topics.length > 0 && normal(topic) !== '' && !topics.some((known) => sameTopic(topic, known));

/** A deck's name from a topic: «технологии» → «Технологии». */
export const deckTitleFor = (topic: string) => {
  const clean = topic.trim().replace(/\s+/g, ' ');
  return clean.charAt(0).toUpperCase() + clean.slice(1);
};
