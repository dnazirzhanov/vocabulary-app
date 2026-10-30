import { useState, type FormEvent } from 'react';
import { api, describeError } from '../lib/api.ts';
import type { GenerateResult } from '../lib/types.ts';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './DeckEditor.module.css';
import { DraftResult } from './DraftResult.tsx';

const COUNTS = [5, 10, 15, 20];
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
const MAX_TEXT = 20_000;

/**
 * The teacher's lesson material in, a draft of cards out (ADR 0018): the cards land in the deck
 * above for review; nothing reaches the students until the deck is given. The text is not kept.
 */
export function GeneratePanel({ deckId, onDrafted }: { deckId: string; onDrafted: (result: GenerateResult) => void }) {
  const [text, setText] = useState('');
  const [count, setCount] = useState(10);
  const [level, setLevel] = useState('B1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<GenerateResult | null>(null);
  const ready = text.trim().length >= 20;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.generateDeck(deckId, text.trim(), count, level);
      setLast(result);
      onDrafted(result);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.paneForm} onSubmit={(event) => void submit(event)} aria-labelledby="tab-text">
      <p className={styles.note}>
        Вставьте текст, упражнение или список слов — подберём слова и составим карточки с переводом и примером. Текст не
        сохраняется.
      </p>
      <label className={styles.field}>
        <span className="visually-hidden">Текст урока</span>
        <textarea
          lang="en"
          rows={7}
          maxLength={MAX_TEXT}
          placeholder="After several setbacks, the company managed to carry out the experiment…"
          value={text}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <div className={styles.options}>
        <fieldset className={styles.choice}>
          <legend>Сколько слов</legend>
          <div className={styles.segments}>
            {COUNTS.map((value) => (
              <label key={value} className={styles.segment} data-selected={value === count || undefined}>
                <input
                  type="radio"
                  name="count"
                  value={value}
                  checked={value === count}
                  disabled={busy}
                  onChange={() => setCount(value)}
                />
                {value}
              </label>
            ))}
          </div>
        </fieldset>
        <label className={styles.field}>
          <span>Уровень учеников</span>
          <select value={level} disabled={busy} onChange={(event) => setLevel(event.target.value)}>
            {LEVELS.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      <PrimaryButton type="submit" disabled={busy || !ready} aria-busy={busy}>
        {busy ? 'Подбираем слова…' : 'Подобрать слова'}
      </PrimaryButton>
      <div role="status" className={styles.generateStatus}>
        {busy && <p className={styles.note}>Читаем текст и составляем карточки — это может занять до минуты.</p>}
        {!busy && last && <DraftResult result={last} />}
      </div>
      {error && (
        <p className={styles.problem} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
