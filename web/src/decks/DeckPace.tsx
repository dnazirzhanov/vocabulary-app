import { useState } from 'react';
import { api } from '../lib/api.ts';
import { localToday, deadlineNote } from '../lib/deadline.ts';
import { MAX_TARGET, MIN_TARGET, wordsLabel } from '../lib/pace.ts';
import type { Pace } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './DeckPace.module.css';

const PACE_CHOICES = [5, 10, 15, 20, 30];
const EXTRA_CHOICES = [5, 10, 20, 50, 100];
/** At most this many extra words at a time, whatever the deck holds. */
const MAX_EXTRA = 100;
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

/**
 * New words a day in this deck (ADR 0028): the number, today's progress against it, a teacher's
 * deadline, and «Изменить» to change it in place — no settings screen to find, as in Anki.
 */
export function DailyPace({ pace, left, onSaved }: { pace: Pace; left: number; onSaved: (pace: Pace) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(pace.target);
  const { run, busy, error } = useAsyncAction();
  // Today's goal, never more than the words still there to meet.
  const goal = Math.min(pace.effective_target, pace.new_words_today + left);
  const deadline = deadlineNote(pace.deadline, localToday(), pace.deadline_share, left, pace.target);

  return (
    <div className={styles.pace}>
      {deadline && (
        <p className={styles.deadline} role="note">
          {deadline}
        </p>
      )}
      <div className={styles.line}>
        <p>
          Новых слов в день: <strong>{pace.target}</strong>
          {pace.course && <span className={styles.muted}> · для всего курса</span>}
          {goal > 0 && (
            <span className={styles.muted}>
              {' '}
              · сегодня {pace.new_words_today} из {goal}
              {pace.extra_today > 0 && ` (+${pace.extra_today} сверх)`}
            </span>
          )}
        </p>
        {!editing && (
          <button
            type="button"
            className={styles.change}
            onClick={() => (setValue(pace.target), setEditing(true))}
            aria-label="Изменить число новых слов в день"
          >
            Изменить
          </button>
        )}
      </div>
      {editing && (
        <form
          className={styles.editor}
          aria-label="Новых слов в день"
          onSubmit={(event) => {
            event.preventDefault();
            run(async () => {
              onSaved(await api.setDeckPace(pace.deck_id, value));
              setEditing(false);
            });
          }}
        >
          <div className={styles.stepper}>
            <button
              type="button"
              aria-label="Меньше"
              disabled={value <= MIN_TARGET}
              onClick={() => setValue(value - 1)}
            >
              −
            </button>
            <input
              type="number"
              inputMode="numeric"
              min={MIN_TARGET}
              max={MAX_TARGET}
              value={value}
              aria-label="Слов в день"
              onChange={(event) => setValue(clamp(Number(event.target.value) || MIN_TARGET, MIN_TARGET, MAX_TARGET))}
              data-autofocus
            />
            <button
              type="button"
              aria-label="Больше"
              disabled={value >= MAX_TARGET}
              onClick={() => setValue(value + 1)}
            >
              +
            </button>
          </div>
          <div className={styles.chips} role="group" aria-label="Быстрый выбор">
            {PACE_CHOICES.map((choice) => (
              <button key={choice} type="button" aria-pressed={choice === value} onClick={() => setValue(choice)}>
                {choice}
              </button>
            ))}
          </div>
          {pace.deadline && pace.deadline_share > value && (
            <p className={styles.muted}>
              До срока сегодня всё равно {wordsLabel(pace.deadline_share)}: так колода будет выучена вовремя.
            </p>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.buttons}>
            <button type="submit" className={styles.save} disabled={busy}>
              Сохранить
            </button>
            <button type="button" className={styles.cancel} onClick={() => setEditing(false)}>
              Отмена
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * «Ещё слов сегодня»: how many extra new words to take now, today only. They are the deck's next
 * words; tomorrow the usual number comes, from where these stopped.
 */
export function ExtraWords({
  open,
  pace,
  left,
  onClose,
  onStart,
}: {
  open: boolean;
  pace: Pace;
  left: number;
  onClose: () => void;
  onStart: (words: number) => Promise<void>;
}) {
  const [words, setWords] = useState(5);
  // A deck can hold fewer words than asked: then it gives every one it has left.
  const given = Math.min(words, left);
  const { run, busy, error } = useAsyncAction();
  return (
    <Dialog open={open} onClose={onClose} title="Ещё слов сегодня">
      <p className={styles.muted}>
        Только на сегодня — следующие слова колоды. Завтра снова {wordsLabel(pace.target)} в день, с того места, где вы
        остановились.
      </p>
      <div className={styles.chips} role="group" aria-label="Сколько слов">
        {EXTRA_CHOICES.map((choice) => (
          <button key={choice} type="button" aria-pressed={choice === words} onClick={() => setWords(choice)}>
            {choice}
          </button>
        ))}
      </div>
      <label className={styles.own}>
        <span>Своё число</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_EXTRA}
          value={words}
          onChange={(event) => setWords(clamp(Number(event.target.value) || 1, 1, MAX_EXTRA))}
        />
      </label>
      {words > left && (
        <p className={styles.muted} role="status">
          В колоде осталось {wordsLabel(left)} — вы получите все.
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <PrimaryButton type="button" disabled={busy} aria-busy={busy} onClick={() => run(() => onStart(words))}>
        {busy ? 'Загружаем…' : `Начать · ${wordsLabel(given)}`}
      </PrimaryButton>
    </Dialog>
  );
}
