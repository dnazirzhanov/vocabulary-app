import { useState } from 'react';
import { api } from '../lib/api.ts';
import { MAX_TARGET, MIN_TARGET, wordsLabel } from '../lib/pace.ts';
import { newWords } from '../lib/today.ts';
import type { Pace } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './DeckPace.module.css';
import { t } from '../i18n/index.ts';

const PACE_CHOICES = [5, 10, 15, 20, 30];
const EXTRA_CHOICES = [5, 10, 20, 50, 100];
/** At most this many extra words at a time, whatever the deck holds. */
const MAX_EXTRA = 100;
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

/**
 * New words a day in this deck (ADR 0028): the number, and «Изменить» to change it in place — no
 * settings screen to find, as in Anki.
 */
export function DailyPace({ pace, onSaved }: { pace: Pace; onSaved: (pace: Pace) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(pace.target);
  const { run, busy, error } = useAsyncAction();

  return (
    <div className={styles.pace}>
      <div className={styles.line}>
        {/* The number the learner chose (ADR 0028, 0035); today's count is on the button. */}
        <p>
          {t.perDay} <strong>{newWords(pace.target)}</strong>
          {pace.ramp_week != null && <span className={styles.muted}>{t.warmupForNow(pace.effective_target)}</span>}
          {pace.course && <span className={styles.muted}>{t.forTheWholeCourse}</span>}
        </p>
        {!editing && (
          <button
            type="button"
            className={styles.change}
            onClick={() => (setValue(pace.target), setEditing(true))}
            aria-label={t.changeTheNumberOfNewWords}
          >
            {t.edit}
          </button>
        )}
      </div>
      {editing && (
        <form
          className={styles.editor}
          aria-label={t.newWordsADay}
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
              aria-label={t.fewer}
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
              aria-label={t.wordsADay}
              onChange={(event) => setValue(clamp(Number(event.target.value) || MIN_TARGET, MIN_TARGET, MAX_TARGET))}
              data-autofocus
            />
            <button
              type="button"
              aria-label={t.more}
              disabled={value >= MAX_TARGET}
              onClick={() => setValue(value + 1)}
            >
              +
            </button>
          </div>
          <div className={styles.chips} role="group" aria-label={t.quickChoice}>
            {PACE_CHOICES.map((choice) => (
              <button key={choice} type="button" aria-pressed={choice === value} onClick={() => setValue(choice)}>
                {choice}
              </button>
            ))}
          </div>
          {pace.deadline && pace.deadline_share > value && (
            <p className={styles.muted}>{t.deadlineShareNote(wordsLabel(pace.deadline_share))}</p>
          )}
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.buttons}>
            <button type="submit" className={styles.save} disabled={busy}>
              {t.save}
            </button>
            <button type="button" className={styles.cancel} onClick={() => setEditing(false)}>
              {t.cancel}
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
    <Dialog open={open} onClose={onClose} title={t.moreWordsToday}>
      <p className={styles.muted}>{t.moreTodayNote(wordsLabel(pace.target))}</p>
      <div className={styles.chips} role="group" aria-label={t.howManyWords}>
        {EXTRA_CHOICES.map((choice) => (
          <button key={choice} type="button" aria-pressed={choice === words} onClick={() => setWords(choice)}>
            {choice}
          </button>
        ))}
      </div>
      <label className={styles.own}>
        <span>{t.yourOwnNumber}</span>
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
          {t.deckLeftNote(wordsLabel(left))}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <PrimaryButton type="button" disabled={busy} aria-busy={busy} onClick={() => run(() => onStart(words))}>
        {busy ? t.loading : t.start(wordsLabel(given))}
      </PrimaryButton>
    </Dialog>
  );
}

const PRACTICE_CHOICES = [10, 20];

/**
 * «Повторить сейчас»: go over words already met, as many as one likes, before they come back. It
 * never changes when they come back.
 */
export function Practice({
  open,
  met,
  onClose,
  onStart,
}: {
  open: boolean;
  met: number;
  onClose: () => void;
  onStart: (count: number | null) => Promise<void>;
}) {
  const choices = PRACTICE_CHOICES.filter((choice) => choice < met);
  const [count, setCount] = useState<number | null>(choices[0] ?? null);
  const { run, busy, error } = useAsyncAction();
  return (
    <Dialog open={open} onClose={onClose} title={t.practiceNow}>
      <p className={styles.muted}>{t.practiceNote}</p>
      <div className={styles.chips} role="group" aria-label={t.howManyWords}>
        {choices.map((choice) => (
          <button key={choice} type="button" aria-pressed={choice === count} onClick={() => setCount(choice)}>
            {choice}
          </button>
        ))}
        <button type="button" aria-pressed={count === null} onClick={() => setCount(null)}>
          {t.allCount(met)}
        </button>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <PrimaryButton type="button" disabled={busy} aria-busy={busy} onClick={() => run(() => onStart(count))}>
        {busy ? t.loading : t.start(wordsLabel(count ?? met))}
      </PrimaryButton>
    </Dialog>
  );
}
