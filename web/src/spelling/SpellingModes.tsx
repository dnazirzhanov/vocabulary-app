import { useState } from 'react';
import { wordsLabel } from '../lib/pace.ts';
import { SPELLING_SIZES, type SpellingMode, type SpellingSize, type SpellingState } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './SpellingModes.module.css';

type Choice = Exclude<SpellingMode, 'mix'>;

/** The other sets of words to spell (ADR 0026), each with what it holds now. */
function modes(state: SpellingState): { id: Choice; title: string; note: string; count: number }[] {
  return [
    {
      id: 'today',
      title: 'Сегодняшние',
      note: state.today ? `${wordsLabel(state.today)}, выученных сегодня` : 'Сегодня новых слов ещё не было',
      count: state.today,
    },
    {
      id: 'hard',
      title: 'Трудные',
      note: state.hard ? `${wordsLabel(state.hard)} с ошибкой в прошлый раз` : 'Трудных слов нет',
      count: state.hard,
    },
    {
      id: 'random',
      title: 'Вразброс',
      note: `Из ${wordsLabel(state.met)}, которые вы встречали`,
      count: state.met,
    },
  ];
}

/**
 * «Другие режимы»: today's words, the hard ones, or a random draw, 5 to 30 at a time. The main
 * button stays one tap on the deck's page; this is for when the learner wants something else.
 * Starting one replaces a spelling left unfinished (ADR 0050), so it says so.
 */
export function SpellingModes({
  open,
  state,
  onClose,
  onStart,
}: {
  open: boolean;
  state: SpellingState;
  onClose: () => void;
  onStart: (mode: SpellingMode, size: SpellingSize) => Promise<void>;
}) {
  const options = modes(state);
  const [mode, setMode] = useState<Choice>(() => options.find((option) => option.count > 0)?.id ?? 'random');
  const [size, setSize] = useState<SpellingSize>(10);
  const { run, busy, error } = useAsyncAction();
  const chosen = options.find((option) => option.id === mode)!;

  return (
    <Dialog open={open} onClose={onClose} title="Правописание">
      <fieldset className={styles.modes}>
        <legend className="visually-hidden">Какие слова</legend>
        {options.map((option) => (
          <label key={option.id} className={styles.mode} data-disabled={option.count === 0 || undefined}>
            <input
              type="radio"
              name="spelling-mode"
              value={option.id}
              checked={mode === option.id}
              disabled={option.count === 0}
              onChange={() => setMode(option.id)}
            />
            <span>
              <strong>{option.title}</strong>
              <small>{option.note}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <p className={styles.label} id="spelling-size">
        Сколько слов
      </p>
      <div className={styles.sizes} role="group" aria-labelledby="spelling-size">
        {SPELLING_SIZES.map((option) => (
          <button key={option} type="button" aria-pressed={option === size} onClick={() => setSize(option)}>
            {option}
          </button>
        ))}
      </div>
      {state.paused && <p className={styles.note}>Незаконченное правописание закроется, написанное сохранится.</p>}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <PrimaryButton
        type="button"
        disabled={busy || chosen.count === 0}
        aria-busy={busy}
        onClick={() => run(() => onStart(mode, size))}
      >
        {busy ? 'Загружаем…' : `Начать · ${wordsLabel(Math.min(size, chosen.count))}`}
      </PrimaryButton>
    </Dialog>
  );
}
