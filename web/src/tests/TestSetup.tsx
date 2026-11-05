import { useEffect, useRef, useState } from 'react';
import { api, ApiError, describeError } from '../lib/api.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import type { TestSetupInfo } from '../lib/types.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import shared from '../groups/Groups.module.css';
import styles from './Tests.module.css';

const DEFAULT_COUNT = 10;

const whole = (text: string): number => (/^\d+$/.test(text) ? Number(text) : Number.NaN);
const within = (value: number, low: number, high: number): boolean => value >= low && value <= high;

/** Four things and everything already filled in, so one tap is enough; opening is a separate tap. */
export function TestSetup(props: { groupId: string; deckId: string; onClose: () => void; onSaved: () => void }) {
  const { groupId, deckId, onClose, onSaved } = props;
  const [setup, setSetup] = useState<TestSetupInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [random, setRandom] = useState(false);
  const [count, setCount] = useState(String(DEFAULT_COUNT));
  const [minutes, setMinutes] = useState('');
  const [percent, setPercent] = useState('');
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [choosing, setChoosing] = useState(false);
  // The server said other words would erase results: ask before doing it.
  const [confirming, setConfirming] = useState(false);
  const { run, busy, error } = useAsyncAction();
  const cancelRef = useRef<HTMLButtonElement>(null);
  // A reflexive Enter on the question must not erase anything.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  useEffect(() => {
    // Only the latest load may fill the form: a later answer must not wipe what was just tapped.
    let current = true;
    api.testSetup(groupId, deckId).then(
      (loaded) => {
        if (!current) return;
        setSetup(loaded);
        setRandom(loaded.question_count !== null);
        const pool = loaded.words.length - loaded.excluded_word_ids.length;
        setCount(String(loaded.question_count ?? Math.min(DEFAULT_COUNT, pool)));
        setMinutes(String(loaded.minutes));
        setPercent(String(loaded.pass_percent));
        setExcluded(new Set(loaded.excluded_word_ids));
      },
      (caught: unknown) => {
        if (current) setLoadError(describeError(caught));
      },
    );
    return () => {
      current = false;
    };
  }, [groupId, deckId]);

  const pool = setup ? setup.words.length - excluded.size : 0;
  // Why «Сохранить» is off, so a grey button is never a puzzle.
  const problem =
    pool === 0
      ? 'Оставьте хотя бы одно слово.'
      : random && !within(whole(count), 1, pool)
        ? `Случайных слов: от 1 до ${pool}.`
        : !within(whole(minutes), 1, 180)
          ? 'Время: от 1 до 180 минут.'
          : !within(whole(percent), 1, 100)
            ? 'Сдать от: от 1 до 100%.'
            : null;
  const valid = problem === null;

  const save = (reset: boolean) =>
    run(async () => {
      try {
        await api.saveTest(groupId, deckId, {
          question_count: random ? whole(count) : null,
          excluded_word_ids: [...excluded],
          pass_percent: whole(percent),
          minutes: whole(minutes),
          reset,
        });
        onSaved();
      } catch (caught) {
        if (caught instanceof ApiError && caught.code === 'results_exist') setConfirming(true);
        else throw caught;
      }
    });

  const toggle = (id: string) =>
    setExcluded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <Dialog open onClose={onClose} title={confirming ? 'Другие слова — новый тест' : 'Настройка теста'}>
      {loadError && (
        <p className={shared.problem} role="alert">
          {loadError}
        </p>
      )}
      {!setup && !loadError && <p aria-busy="true">Загружаем…</p>}
      {setup && confirming && (
        <div className={styles.setup}>
          <p>Результаты теста будут удалены: {setup.results}. Все пройдут его заново.</p>
          {error && (
            <p className={shared.problem} role="alert">
              {error}
            </p>
          )}
          <button ref={cancelRef} type="button" className={shared.smallButton} onClick={() => setConfirming(false)}>
            Отмена
          </button>
          <button type="button" className={shared.linkButton} disabled={busy} onClick={() => void save(true)}>
            Удалить результаты и сохранить
          </button>
        </div>
      )}
      {setup && !confirming && (
        <form
          className={styles.setup}
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) void save(false);
          }}
        >
          <fieldset className={styles.choice}>
            <legend>Слова</legend>
            <label>
              <input type="radio" name="test-words" checked={!random} onChange={() => setRandom(false)} />
              Все ({pool})
            </label>
            <label>
              <input type="radio" name="test-words" checked={random} onChange={() => setRandom(true)} />
              Случайные
              {random && (
                <input
                  className={styles.count}
                  aria-label="Сколько случайных слов"
                  inputMode="numeric"
                  value={count}
                  onChange={(event) => setCount(event.target.value)}
                />
              )}
            </label>
          </fieldset>

          <div className={styles.numbers}>
            <label className={shared.field}>
              Время, мин
              <input inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value)} />
            </label>
            <label className={shared.field}>
              Сдать от, %
              <input inputMode="numeric" value={percent} onChange={(event) => setPercent(event.target.value)} />
            </label>
          </div>

          <button
            type="button"
            className={`${shared.linkButton} ${styles.remove}`}
            aria-expanded={choosing}
            onClick={() => setChoosing(!choosing)}
          >
            {excluded.size > 0 ? `Убраны: ${excluded.size}` : 'Убрать слова'}
          </button>
          {choosing && (
            <ul className={styles.wordChoices}>
              {setup.words.map((word) => (
                <li key={word.id}>
                  <label>
                    <input type="checkbox" checked={!excluded.has(word.id)} onChange={() => toggle(word.id)} />
                    <strong lang="en">{word.headword}</strong> <span>{word.translation}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {setup && problem && <p className={shared.note}>{problem}</p>}
          {error && (
            <p className={shared.problem} role="alert">
              {error}
            </p>
          )}
          <PrimaryButton type="submit" disabled={busy || !valid} aria-busy={busy}>
            Сохранить
          </PrimaryButton>
        </form>
      )}
    </Dialog>
  );
}
