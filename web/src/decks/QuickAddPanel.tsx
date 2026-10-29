import { useState, type FormEvent } from 'react';
import { api, describeError } from '../lib/api.ts';
import { wordsIn } from '../lib/quickAdd.ts';
import type { GenerateResult } from '../lib/types.ts';
import styles from './DeckEditor.module.css';
import { DraftResult } from './DraftResult.tsx';

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
const MAX_WORDS = 20;

/**
 * The fast way (ADR 0019): name the words, get full cards — meaning, part of speech, an example
 * and its translation — saved to the deck for review. The device reads them aloud.
 */
export function QuickAddPanel({
  deckId,
  forGroup,
  onAdded,
}: {
  deckId: string;
  forGroup: boolean;
  onAdded: (result: GenerateResult) => void;
}) {
  const [typed, setTyped] = useState('');
  const [level, setLevel] = useState('B1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<GenerateResult | null>(null);
  const words = wordsIn(typed);
  const tooMany = words.length > MAX_WORDS;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || words.length === 0 || tooMany) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.fillWords(deckId, words, level);
      setLast(result);
      setTyped('');
      onAdded(result);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.panel} onSubmit={(event) => void submit(event)} aria-labelledby="quick-title">
      <h2 id="quick-title" className={styles.formTitle}>
        Быстро добавить
      </h2>
      <p className={styles.note}>Напишите слова — ИИ составит карточки: перевод, пример и его перевод.</p>
      <label className={styles.field}>
        <span className="visually-hidden">Слова для карточек</span>
        <textarea
          lang="en"
          rows={2}
          autoCapitalize="none"
          spellCheck={false}
          placeholder="apple, carry out, reluctant"
          value={typed}
          disabled={busy}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            // Enter adds; Shift+Enter starts a new line for a list.
            if (event.key === 'Enter' && !event.shiftKey) void submit(event);
          }}
        />
      </label>
      <div className={styles.options}>
        <label className={styles.field}>
          <span>Уровень</span>
          <select value={level} disabled={busy} onChange={(event) => setLevel(event.target.value)}>
            {LEVELS.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className={styles.outlineButton}
          disabled={busy || words.length === 0 || tooMany}
          aria-busy={busy}
        >
          {busy ? 'Составляем…' : words.length > 1 ? `Создать карточки · ${words.length}` : 'Создать карточку'}
        </button>
      </div>
      <div role="status" className={styles.generateStatus}>
        {tooMany && <p className={styles.note}>За один раз — до {MAX_WORDS} слов.</p>}
        {busy && <p className={styles.note}>Составляем карточки — обычно несколько секунд.</p>}
        {!busy && last && <DraftResult result={last} forGroup={forGroup} />}
      </div>
      {error && (
        <p className={styles.problem} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
