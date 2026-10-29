import { useState, type FormEvent } from 'react';
import { api, describeError } from '../lib/api.ts';
import type { GenerateResult } from '../lib/types.ts';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './DeckEditor.module.css';
import { DraftResult } from './DraftResult.tsx';

const COUNTS = [5, 10, 15, 20];
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];

/**
 * A topic in, the words for it out (ADR 0019): the AI chooses what a learner at that level needs
 * to talk about it — nouns, verbs and set phrases — and writes full cards, saved for review.
 */
export function TopicPanel({ deckId, onAdded }: { deckId: string; onAdded: (result: GenerateResult) => void }) {
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(10);
  const [level, setLevel] = useState('B1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<GenerateResult | null>(null);
  const ready = topic.trim().length >= 2;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.topicWords(deckId, topic.trim(), count, level);
      setLast(result);
      onAdded(result);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.paneForm} onSubmit={(event) => void submit(event)} aria-labelledby="tab-topic">
      <p className={styles.note}>Назовите тему — ИИ подберёт нужные для неё слова и составит карточки.</p>
      <label className={styles.field}>
        <span>Тема</span>
        <input
          maxLength={80}
          placeholder="Например: в аэропорту, еда, собеседование"
          value={topic}
          disabled={busy}
          onChange={(event) => setTopic(event.target.value)}
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
                  name="topic-count"
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
          <span>Уровень</span>
          <select value={level} disabled={busy} onChange={(event) => setLevel(event.target.value)}>
            {LEVELS.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      <PrimaryButton type="submit" disabled={busy || !ready} aria-busy={busy}>
        {busy ? 'Подбираем слова…' : `Составить карточки · ${count}`}
      </PrimaryButton>
      <div role="status" className={styles.generateStatus}>
        {busy && <p className={styles.note}>Подбираем слова по теме — обычно несколько секунд.</p>}
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
