import { CheckIcon, CrossIcon } from '../ui/icons.tsx';
import styles from './AnswerOption.module.css';

export type AnswerOptionState = 'idle' | 'selected' | 'correct' | 'incorrect' | 'dimmed';

interface AnswerOptionProps {
  name: string;
  index: number;
  label: string;
  state: AnswerOptionState;
  checked: boolean;
  onSelect: () => void;
}

const statusText: Partial<Record<AnswerOptionState, string>> = {
  correct: 'правильный ответ',
  incorrect: 'ваш ответ, неверно',
};

export function AnswerOption({ name, index, label, state, checked, onSelect }: AnswerOptionProps) {
  const status = statusText[state];
  return (
    <label className={styles.option} data-state={state}>
      <input type="radio" name={name} className={styles.input} checked={checked} onChange={onSelect} />
      <span className={styles.marker} aria-hidden="true">
        {state === 'correct' ? <CheckIcon /> : state === 'incorrect' ? <CrossIcon /> : index + 1}
      </span>
      <span className={styles.label}>{label}</span>
      {status && <span className="visually-hidden">, {status}</span>}
    </label>
  );
}
