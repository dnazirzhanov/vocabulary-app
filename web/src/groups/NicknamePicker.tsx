import { useId, useState } from 'react';
import { nicknameProblem, suggestNicknames } from '../lib/nickname.ts';
import { RepeatIcon } from '../ui/icons.tsx';
import styles from './Groups.module.css';

interface NicknamePickerProps {
  value: string;
  onChange: (nickname: string) => void;
}

/** Pick a generated nickname (no typing, nothing personal) or type one's own. */
export function NicknamePicker({ value, onChange }: NicknamePickerProps) {
  const id = useId();
  const [suggestions, setSuggestions] = useState(() => suggestNicknames(3));
  const [typing, setTyping] = useState(false);
  const problem = typing && value ? nicknameProblem(value) : null;

  return (
    <fieldset className={styles.nickname}>
      <legend className={styles.label}>Имя в группе</legend>
      <p className={styles.hint}>Его увидят участники группы. Настоящее имя и e-mail не нужны.</p>
      <div className={styles.chips}>
        {suggestions.map((suggestion) => (
          <label key={suggestion} className={styles.chip} data-selected={!typing && value === suggestion}>
            <input
              type="radio"
              name={`${id}-nickname`}
              className={styles.chipInput}
              checked={!typing && value === suggestion}
              onChange={() => {
                setTyping(false);
                onChange(suggestion);
              }}
            />
            {suggestion}
          </label>
        ))}
        <button
          type="button"
          className={styles.reroll}
          onClick={() => {
            const next = suggestNicknames(3);
            setSuggestions(next);
            setTyping(false);
            onChange(next[0]);
          }}
        >
          <RepeatIcon aria-hidden="true" /> Другие
        </button>
      </div>
      <label className={styles.field}>
        <span>Или своё</span>
        <input
          type="text"
          maxLength={20}
          autoComplete="off"
          value={typing ? value : ''}
          placeholder="например, Ёжик"
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${id}-problem` : undefined}
          onChange={(event) => {
            setTyping(true);
            onChange(event.target.value);
          }}
        />
      </label>
      {problem && (
        <p id={`${id}-problem`} className={styles.problem}>
          {problem}
        </p>
      )}
    </fieldset>
  );
}

export const nicknameReady = (nickname: string) => nickname.trim() !== '' && nicknameProblem(nickname) === null;
