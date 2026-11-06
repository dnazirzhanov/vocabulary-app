import styles from './LanguageSelect.module.css';

/** A language to choose. The list is each language's own name, so it can be read in any of them. */
export function LanguageSelect<Code extends string>(props: {
  label: string;
  value: Code;
  options: Record<Code, string>;
  onChoose: (language: Code) => void;
  compact?: boolean;
}) {
  const { label, value, options, onChoose, compact } = props;
  return (
    <label className={styles.language}>
      <span className={compact ? 'visually-hidden' : undefined}>{label}</span>
      <select value={value} onChange={(event) => onChoose(event.target.value as Code)}>
        {(Object.entries(options) as [Code, string][]).map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}
