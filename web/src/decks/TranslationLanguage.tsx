import { t } from '../i18n/index.ts';
import { CARD_LANGUAGES, type CardLanguage } from '../i18n/languages.ts';
import styles from './DeckEditor.module.css';

/** What the cards being made are translated into (ADR 0055): chosen beside their level. */
export function TranslationLanguage(props: {
  value: CardLanguage;
  disabled?: boolean;
  onChange: (language: CardLanguage) => void;
}) {
  const { value, disabled, onChange } = props;
  return (
    <label className={styles.field}>
      <span>{t.translationLanguage}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as CardLanguage)}>
        {(Object.entries(CARD_LANGUAGES) as [CardLanguage, string][]).map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}
