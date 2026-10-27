import { useEffect, useState } from 'react';
import {
  answerOf,
  backspace,
  differences,
  pick,
  removeAt,
  savePicks,
  savedPicks,
  tileForKey,
} from '../lib/spelling.ts';
import type { AttemptResult, SpellingExercise as Exercise } from '../lib/types.ts';
import { CheckIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './SpellingExercise.module.css';

interface SpellingExerciseProps {
  exercise: Exercise;
  /** Where a half-built answer is kept across a reload. */
  storageKey: string;
  /** Checking with the server: the tiles wait. */
  busy: boolean;
  /** The checked answer, once the server has it: the exercise explains it. */
  result: AttemptResult | null;
  onSubmit: (answer: string, hintUsed: boolean) => void;
  onContinue: () => void;
}

/**
 * Build a word with letter tiles (ADR 0016). Guided shows the English word; recall shows only its
 * meaning. Tiles are buttons, so the phone's keyboard never opens; a physical keyboard can type
 * the letters too. After a guided mistake the word is built right before moving on.
 */
export function SpellingExercise({ exercise, storageKey, busy, result, onSubmit, onContinue }: SpellingExerciseProps) {
  const guided = exercise.type === 'spell_guided';
  const word = guided ? exercise.word.headword : null;
  const slots = guided ? exercise.word.headword.length : exercise.slots;
  const [picked, setPicked] = useState(() => savedPicks(storageKey));
  // A guided word built wrong is built again, right, before moving on (checked here: it is visible).
  const [fixing, setFixing] = useState(false);
  const answer = answerOf(exercise.tiles, picked);
  const full = picked.length === slots;
  const feedback = result !== null && !fixing;
  const editable = !busy && (!feedback || fixing);
  const fixedRight = fixing && word !== null && answer === word;

  useEffect(() => savePicks(storageKey, feedback ? [] : picked), [storageKey, picked, feedback]);

  const check = () => {
    if (!full || busy) return;
    if (fixing) {
      if (fixedRight) onContinue();
      return;
    }
    onSubmit(answer, false);
  };
  const next = () => {
    if (guided && result && !result.correct) {
      setFixing(true);
      setPicked([]);
    } else onContinue();
  };

  // A physical keyboard: letters pick tiles, Backspace takes the last one back, Enter checks.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.target as Element).closest('input, textarea, select, dialog, [role="dialog"]')) return;
      if (event.key === 'Enter') {
        if ((event.target as Element).closest('button')) return; // the button handles it
        event.preventDefault();
        if (feedback) next();
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
      if (tile !== null) setPicked((current) => pick(current, tile, slots));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <article className={styles.exercise} data-spelling={exercise.id}>
      <p className={styles.eyebrow}>
        Правописание · {guided ? 'соберите слово' : exercise.retry ? 'ещё раз, по памяти' : 'по памяти'}
      </p>
      <div className={styles.prompt}>
        {guided ? (
          <>
            <p className={styles.meaning} data-translation>
              {exercise.word.translation}
            </p>
            <h1 className={styles.word} lang="en" tabIndex={-1} data-autofocus>
              {exercise.word.headword}
            </h1>
          </>
        ) : (
          <>
            <h1 className={styles.meaning} tabIndex={-1} data-autofocus data-translation>
              {exercise.prompt.translation}
            </h1>
            <p className={styles.context}>{exercise.prompt.example_ru}</p>
          </>
        )}
      </div>

      <ol className={styles.slots} aria-label={`Ответ: ${picked.length} из ${slots} букв`}>
        {Array.from({ length: slots }, (_, slot) => {
          const tile = picked[slot];
          const letter = tile === undefined ? null : exercise.tiles[tile];
          return (
            <li key={slot}>
              {letter === null ? (
                <span className={styles.slot} data-empty aria-label={`Буква ${slot + 1}: пусто`} />
              ) : (
                <button
                  type="button"
                  className={styles.slot}
                  disabled={!editable}
                  onClick={() => setPicked((current) => removeAt(current, slot))}
                  aria-label={`Буква ${slot + 1}: ${letter}, убрать`}
                >
                  {letter}
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {feedback ? (
        <Feedback result={result} built={answer} guided={guided} />
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
                  onClick={() => setPicked((current) => pick(current, tile, slots))}
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
          </div>
          {fixing && full && !fixedRight && (
            <p className={styles.fixHint} role="status">
              Сверьтесь со словом вверху и поправьте буквы.
            </p>
          )}
        </>
      )}

      <div className={styles.actions}>
        {feedback ? (
          <PrimaryButton type="button" className={styles.primary} onClick={next}>
            {guided && !result.correct
              ? 'Собрать правильно'
              : !guided && (!result.correct || result.hint_used)
                ? 'Потренировать написание'
                : 'Дальше'}
          </PrimaryButton>
        ) : (
          <PrimaryButton
            type="button"
            className={styles.primary}
            disabled={!full || busy || (fixing && !fixedRight)}
            aria-busy={busy}
            onClick={check}
          >
            {busy ? 'Проверяем…' : fixing ? 'Дальше' : 'Проверить'}
          </PrimaryButton>
        )}
        {!guided && !feedback && (
          <button type="button" className={styles.showWord} disabled={busy} onClick={() => onSubmit(answer, true)}>
            Показать слово
          </button>
        )}
      </div>
    </article>
  );
}

/** What the server said about the built word: right, shown, or which letters differ. */
function Feedback({ result, built, guided }: { result: AttemptResult; built: string; guided: boolean }) {
  const word = result.answer ?? '';
  if (result.hint_used) {
    return (
      <div className={styles.feedback} role="status">
        <p className={styles.verdict}>Слово</p>
        <p className={styles.answer} lang="en">
          {word}
        </p>
        <p className={styles.note}>Сейчас соберём его вместе, а позже — ещё раз по памяти.</p>
      </div>
    );
  }
  if (result.correct) {
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
      {!guided && <p className={styles.note}>Соберём слово вместе, а позже — ещё раз по памяти.</p>}
    </div>
  );
}
