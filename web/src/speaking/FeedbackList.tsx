import { t } from '../i18n/index.ts';
import type { FeedbackItem } from './api.ts';
import styles from './FeedbackList.module.css';

interface Props {
  items: FeedbackItem[];
}

export function FeedbackList({ items }: Props) {
  if (items.length === 0) return null;

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>{t.speakingFeedbackHeading}</h2>
      <ul className={styles.list}>
        {items.map((item, i) => (
          <li key={i} className={`${styles.item} ${styles[item.severity]}`}>
            <span className={styles.category}>{categoryLabel(item.category)}</span>
            {item.original_text && <span className={styles.original}>"{item.original_text}"</span>}
            {item.corrected_text && <span className={styles.corrected}>→ {item.corrected_text}</span>}
            {item.explanation && <p className={styles.explanation}>{item.explanation}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function categoryLabel(cat: FeedbackItem['category']): string {
  switch (cat) {
    case 'pronunciation':
      return t.speakingFeedbackCategoryPronunciation;
    case 'grammar':
      return t.speakingFeedbackCategoryGrammar;
    case 'vocabulary':
      return t.speakingFeedbackCategoryVocabulary;
    case 'coherence':
      return t.speakingFeedbackCategoryCoherence;
    case 'fluency':
      return t.speakingFeedbackCategoryFluency;
  }
}
