import { Fragment, useEffect, useState } from 'react';
import {
  answerOf,
  backspace,
  differences,
  pick,
  removeAt,
  savePicks,
  slotWords,
  savedPicks,
  tileForKey,
  withSeparators,
} from '../lib/spelling.ts';
import { describeError } from '../lib/api.ts';
import type { AttemptResult, SpellingExercise as Exercise, Hint } from '../lib/types.ts';
import { BulbIcon, CheckIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './SpellingExercise.module.css';

interface SpellingExerciseProps {
  exercise: Exercise;
  /** Where a half-built answer is kept across a reload. */
  storageKey: string;
  /** Checking with the server: the tiles wait. */
  busy: boolean;
  /** The checked first try, once the server has it: the card explains it. */
  result: AttemptResult | null;
  onSubmit: (answer: string) => void;
  onContinue: () => void;
  /** The letter of one slot, from the server (the word stays there): one per card. */
  onHint: (position: number) => Promise<Hint>;
}

/**
 * A spelling card (ADR 0016): the Russian meaning, empty slots, and letter tiles to build the
 * English word. Tiles are buttons, so the phone's keyboard never opens; a physical keyboard can
 * type the letters too. The first try is checked by the server; after a mistake the word is shown
 * and the card may be built again until it is right (checked here), or left.
 */
export function SpellingExercise({
  exercise,
  storageKey,
  busy,
  result,
  onSubmit,
  onContinue,
  onHint,
}: SpellingExerciseProps) {
  const [picked, setPicked] = useState(() => savedPicks(storageKey));
  // After a mistake: building the word again, checked on the device against the shown word.
  const [again, setAgain] = useState(false);
  // One hint per card: the letter of the next empty slot (kept by the server across a reload).
  const [hint, setHint] = useState<Hint | null>(exercise.hint);
  const [hinting, setHinting] = useState(false);
  const [hintNote, setHintNote] = useState<string | null>(null);
  const answer = withSeparators(answerOf(exercise.tiles, picked), exercise.separators);
  const full = picked.length === exercise.slots;
  const word = result?.answer ?? null;
  const builtRight = again && full && answer === word;
  const feedback = result !== null && (!again || builtRight);
  const editable = !busy && (result === null || (again && !builtRight));

  useEffect(() => savePicks(storageKey, result ? [] : picked), [storageKey, picked, result]);

  const check = () => {
    if (full && !busy && result === null) onSubmit(answer);
  };
  const buildAgain = () => {
    setAgain(true);
    setPicked([]);
  };
  const askHint = async () => {
    const position = picked.length;
    setHinting(true);
    setHintNote(null);
    try {
      const given = await onHint(position);
      setHint(given);
      // The tile with that letter goes into the slot; if every such tile is already used
      // elsewhere, the letter is named instead.
      const tile = tileForKey(exercise.tiles, picked, given.letter);
      if (tile !== null && picked.length === given.position)
        setPicked((current) => pick(current, tile, exercise.slots));
      else setHintNote(`Буква ${given.position + 1} — «${given.letter}».`);
    } catch (error) {
      setHintNote(describeError(error));
    } finally {
      setHinting(false);
    }
  };
  const hintedSlot =
    hint !== null && picked[hint.position] !== undefined && exercise.tiles[picked[hint.position]] === hint.letter
      ? hint.position
      : null;

  // A physical keyboard: letters pick tiles, Backspace takes the last one back, Enter checks.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.target as Element).closest('input, textarea, select, dialog, [role="dialog"]')) return;
      if (event.key === 'Enter') {
        if ((event.target as Element).closest('button')) return; // the button handles it
        event.preventDefault();
        if (feedback) onContinue();
        else check();
        return;
      }
      if (!editable) return;
      if (event.key === 'Backspace') {
        event.preventDefault();
        setPicked(backspace);
        return;
      }
      const tile = tileForKey(exercise.tiles, picked, event.key);
      if (tile !== null) setPicked((current) => pick(current, tile, exercise.slots));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <article className={styles.exercise} data-spelling={exercise.id}>
      <p className={styles.eyebrow}>Правописание</p>
      <div className={styles.prompt}>
        <h1 className={styles.meaning} tabIndex={-1} data-autofocus data-translation>
          {exercise.prompt.translation}
        </h1>
        {again && word && (
          <p className={styles.word} lang="en">
            {word}
          </p>
        )}
      </div>

      {/* One list per word of a phrase, so a line breaks between words, never inside one. */}
      <div className={styles.slots} role="group" aria-label={`Ответ: ${picked.length} из ${exercise.slots} букв`}>
        {slotWords(exercise.slots, exercise.separators).map((slots, index) => (
          <ol key={index} className={styles.slotWord}>
            {slots.map((slot) => {
              const tile = picked[slot];
              const letter = tile === undefined ? null : exercise.tiles[tile];
              // A hyphen or apostrophe inside a word (well-known, o'clock): built in, never a tile.
              const mark = exercise.separators.find((s) => s.after === slot && s.char !== ' ' && slot > 0);
              return (
                <Fragment key={slot}>
                  {mark && (
                    <li className={styles.mark} aria-label={mark.char}>
                      {mark.char}
                    </li>
                  )}
                  <li>
                    {letter === null ? (
                      <span className={styles.slot} data-empty aria-label={`Буква ${slot + 1}: пусто`} />
                    ) : (
                      <button
                        type="button"
                        className={styles.slot}
                        data-hinted={slot === hintedSlot || undefined}
                        disabled={!editable}
                        onClick={() => setPicked((current) => removeAt(current, slot))}
                        aria-label={`Буква ${slot + 1}: ${letter}${slot === hintedSlot ? ' (подсказка)' : ''}, убрать`}
                      >
                        {letter}
                      </button>
                    )}
                  </li>
                </Fragment>
              );
            })}
          </ol>
        ))}
      </div>

      {feedback && result ? (
        <Feedback right={Boolean(result.correct) || builtRight} built={answer} word={word ?? ''} />
      ) : (
        <>
          <div className={styles.tiles} role="group" aria-label="Буквы">
            {exercise.tiles.map((letter, tile) => {
              const used = picked.includes(tile);
              return (
                <button
                  key={tile}
                  type="button"
                  className={styles.tile}
                  data-used={used || undefined}
                  disabled={used || !editable}
                  onClick={() => setPicked((current) => pick(current, tile, exercise.slots))}
                  aria-label={used ? `${letter}, уже в ответе` : letter}
                >
                  {used ? '' : letter}
                </button>
              );
            })}
          </div>
          <div className={styles.edit}>
            <button
              type="button"
              className={styles.editButton}
              disabled={!editable || picked.length === 0}
              onClick={() => setPicked(backspace)}
            >
              ⌫ Стереть
            </button>
            <button
              type="button"
              className={styles.editButton}
              disabled={!editable || picked.length === 0}
              onClick={() => setPicked([])}
            >
              Очистить
            </button>
            {!again && (
              <button
                type="button"
                className={styles.hintButton}
                disabled={!editable || hint !== null || hinting || full}
                aria-busy={hinting}
                onClick={() => void askHint()}
              >
                <BulbIcon aria-hidden="true" />
                {hint ? 'Подсказка использована' : 'Подсказка'}
              </button>
            )}
          </div>
          {hintNote && (
            <p className={styles.fixHint} role="status">
              {hintNote}
            </p>
          )}
          {again && full && !builtRight && (
            <p className={styles.fixHint} role="status">
              Сверьтесь со словом вверху и поправьте буквы.
            </p>
          )}
        </>
      )}

      <div className={styles.actions}>
        {result === null ? (
          <PrimaryButton
            type="button"
            className={styles.primary}
            disabled={!full || busy}
            aria-busy={busy}
            onClick={check}
          >
            {busy ? 'Проверяем…' : 'Проверить'}
          </PrimaryButton>
        ) : (
          <PrimaryButton type="button" className={styles.primary} onClick={onContinue}>
            Дальше
          </PrimaryButton>
        )}
        {result && !result.correct && !again && (
          <button type="button" className={styles.showWord} onClick={buildAgain}>
            Собрать ещё раз
          </button>
        )}
      </div>
    </article>
  );
}

/** Right, or which letters differ from the word (underlined and bold, not colour alone). */
function Feedback({ right, built, word }: { right: boolean; built: string; word: string }) {
  if (right) {
    return (
      <div className={styles.feedback} data-tone="right" role="status">
        <p className={styles.verdict}>
          <CheckIcon aria-hidden="true" /> Верно
        </p>
        <p className={styles.answer} lang="en">
          {word}
        </p>
      </div>
    );
  }
  return (
    <div className={styles.feedback} data-tone="wrong" role="status">
      <p className={styles.verdict}>Почти</p>
      <dl className={styles.compare}>
        <div>
          <dt>Ваш ответ</dt>
          <dd lang="en">
            {differences(built, word).map(({ letter, differs }, index) =>
              differs ? (
                <mark key={index} className={styles.differs}>
                  {letter}
                </mark>
              ) : (
                <span key={index}>{letter}</span>
              ),
            )}
          </dd>
        </div>
        <div>
          <dt>Правильно</dt>
          <dd lang="en">{word}</dd>
        </div>
      </dl>
    </div>
  );
}
