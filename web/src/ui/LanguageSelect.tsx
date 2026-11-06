import styles from './LanguageSelect.module.css';

/** The sign-in page's language: no words beside it, since it may be all that person can't read. */
export function LanguageSelect<Code extends string>(props: {
  label: string;
  value: Code;
  options: Record<Code, string>;
  onChoose: (language: Code) => void;
}) {
  const { label, value, options, onChoose } = props;
  return (
    <label className={styles.language}>
      <span className="visually-hidden">{label}</span>
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
