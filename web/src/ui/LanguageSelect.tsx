import { UI_LANGUAGES, type UiLanguage } from '../i18n/languages.ts';
import { t, uiLanguage } from '../i18n/index.ts';
import styles from './LanguageSelect.module.css';

/** The app's language. The list is each language's own name, so it can be read in any of them. */
export function LanguageSelect(props: { onChoose: (language: UiLanguage) => void; compact?: boolean }) {
  const { onChoose, compact } = props;
  return (
    <label className={styles.language}>
      <span className={compact ? 'visually-hidden' : undefined}>{t.appLanguage}</span>
      <select value={uiLanguage} onChange={(event) => onChoose(event.target.value as UiLanguage)}>
        {Object.entries(UI_LANGUAGES).map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}
