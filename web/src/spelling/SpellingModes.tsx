import { useState } from 'react';
import { wordsLabel } from '../lib/pace.ts';
import { SPELLING_SIZES, type SpellingMode, type SpellingSize, type SpellingState } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './SpellingModes.module.css';
import { t } from '../i18n/index.ts';

type Choice = Exclude<SpellingMode, 'mix'>;

/** The other sets of words to spell (ADR 0026), each with what it holds now. */
function modes(state: SpellingState): { id: Choice; title: string; note: string; count: number }[] {
  return [
    {
      id: 'today',
      title: t.todayS,
      note: state.today ? t.learnedToday(wordsLabel(state.today)) : t.noNewWordsTodayYet,
      count: state.today,
    },
    {
      id: 'hard',
      title: t.hardMode,
      note: state.hard ? t.withAMistakeLastTime(wordsLabel(state.hard)) : t.noHardWords,
      count: state.hard,
    },
    {
      id: 'random',
      title: t.shuffled,
      note: t.fromTheYouVeMet(wordsLabel(state.met)),
      count: state.met,
    },
    {
      // For learning new words by spelling them (ADR 0064): met or not.
      id: 'all',
      title: t.allWords,
      note: t.allWordsNote(wordsLabel(state.words)),
      count: state.words,
    },
  ];
}

/**
 * «Другие режимы»: today's words, the hard ones, a random draw, or every word of the deck (ADR
 * 0064), 5 to 30 at a time. The main
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
    <Dialog open={open} onClose={onClose} title={t.spellingTitle}>
      <fieldset className={styles.modes}>
        <legend className="visually-hidden">{t.whichWords}</legend>
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
        {t.howManyWords}
      </p>
      <div className={styles.sizes} role="group" aria-labelledby="spelling-size">
        {SPELLING_SIZES.map((option) => (
          <button key={option} type="button" aria-pressed={option === size} onClick={() => setSize(option)}>
            {option}
          </button>
        ))}
      </div>
      {state.paused && <p className={styles.note}>{t.theUnfinishedSpellingWillCloseWhat}</p>}
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
        {busy ? t.loading : t.start(wordsLabel(Math.min(size, chosen.count)))}
      </PrimaryButton>
    </Dialog>
  );
}
