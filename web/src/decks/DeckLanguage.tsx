import { useState } from 'react';
import { CARD_LANGUAGES, type CardLanguage } from '../i18n/languages.ts';
import { t } from '../i18n/index.ts';
import styles from './DeckLanguage.module.css';

/**
 * What a deck's cards are translated into (ADR 0055): one quiet line, opening the choices. Once the
 * deck has words it is only stated, because a deck never mixes languages.
 */
export function DeckLanguage(props: {
  language: CardLanguage;
  fixed: boolean;
  onChoose: (language: CardLanguage) => void;
}) {
  const { language, fixed, onChoose } = props;
  const [open, setOpen] = useState(false);
  const line = t.translationIn(CARD_LANGUAGES[language]);
  if (fixed) return <p className={styles.line}>{line}</p>;
  if (!open) {
    return (
      <button type="button" className={styles.line} aria-expanded={false} onClick={() => setOpen(true)}>
        {line} <span className={styles.change}>{t.edit}</span>
      </button>
    );
  }
  return (
    <fieldset className={styles.choices}>
      <legend className="visually-hidden">{t.translationLanguage}</legend>
      {(Object.entries(CARD_LANGUAGES) as [CardLanguage, string][]).map(([code, name]) => (
        <button
          key={code}
          type="button"
          className={styles.choice}
          aria-pressed={code === language}
          onClick={() => {
            onChoose(code);
            setOpen(false);
          }}
        >
          {name}
        </button>
      ))}
    </fieldset>
  );
}
