import styles from './CoverageSentence.module.css';

// A real check, not decoration: in the NGSL 1.2 frequency data every word below except "terrible"
// (rank 1,644) and "tea" (rank 1,599) is among the 1,300 most frequent (docs/research/ngsl-coverage-2026-10.md).
const SENTENCE: { text: string; known: boolean }[] = [
  { text: 'The', known: true },
  { text: 'weather', known: true },
  { text: 'was', known: true },
  { text: 'terrible,', known: false },
  { text: 'so', known: true },
  { text: 'we', known: true },
  { text: 'stayed', known: true },
  { text: 'home', known: true },
  { text: 'and', known: true },
  { text: 'drank', known: true },
  { text: 'tea.', known: false },
];
const known = SENTENCE.filter((word) => word.known).length;

/** Shows what "about 80% of the words" feels like on one everyday sentence. */
export function CoverageSentence({ percent }: { percent: number | null }) {
  return (
    <figure className={styles.figure}>
      {percent !== null && (
        // Desktop only: the heading beside it says the same on small screens.
        <p className={styles.big} aria-hidden="true">
          ≈{percent}%<span>слов в обычном тексте</span>
        </p>
      )}
      <p className={styles.sentence} lang="en">
        {SENTENCE.map((word, index) => (
          <span key={index} className={word.known ? styles.known : styles.unknown}>
            {word.text}
          </span>
        ))}
      </p>
      <figcaption className={styles.caption}>
        <span className={styles.legendKnown} aria-hidden="true" />
        {known} из {SENTENCE.length} слов — из списка 1&nbsp;300
      </figcaption>
    </figure>
  );
}
