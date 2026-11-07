import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, describeError } from '../lib/api.ts';
import { deckTitleFor, isNewTopic } from '../lib/topics.ts';
import type { GenerateResult } from '../lib/types.ts';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './DeckEditor.module.css';
import { DraftResult } from './DraftResult.tsx';
import { t } from '../i18n/index.ts';

const COUNTS = [5, 10, 15, 20];
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];

/**
 * A topic in, the words for it out (ADR 0019): the AI chooses what a learner at that level needs
 * to talk about it — nouns, verbs and set phrases — and writes full cards, saved for review.
 */
export function TopicPanel({
  deckId,
  topics,
  onAdded,
  onOpenDeck,
}: {
  deckId: string;
  /** The deck's topics, the latest first: the field starts with it, so continuing is one tap. */
  topics: string[];
  onAdded: (result: GenerateResult) => void;
  /** Another deck, made here for a new topic. */
  onOpenDeck: (deckId: string) => void;
}) {
  const [topic, setTopic] = useState(topics[0] ?? '');
  // A different topic than the deck's: offer it a deck of its own before adding here.
  const [fork, setFork] = useState(false);
  const forkRef = useRef<HTMLDivElement>(null);
  // The offer grows below the tapped button: bring its buttons above the bottom bar, scrolling
  // only the editor's own area.
  useEffect(() => {
    const offer = forkRef.current;
    const main = offer?.closest('main');
    if (!fork || !offer || !main) return;
    const below = offer.getBoundingClientRect().bottom - main.getBoundingClientRect().bottom;
    if (below > 0) main.scrollBy({ top: below + 16 });
  }, [fork]);
  const [count, setCount] = useState(10);
  const [level, setLevel] = useState('B1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<GenerateResult | null>(null);
  const ready = topic.trim().length >= 2;

  const draft = async (into: 'here' | 'new') => {
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    try {
      if (into === 'new') {
        const deck = await api.createDeck(deckTitleFor(topic));
        await api.topicWords(deck.id, topic.trim(), count, level);
        onOpenDeck(deck.id);
        return;
      }
      const result = await api.topicWords(deckId, topic.trim(), count, level);
      setFork(false);
      setLast(result);
      onAdded(result);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (isNewTopic(topic, topics) && !fork) return setFork(true);
    void draft('here');
  };

  return (
    <form className={styles.paneForm} onSubmit={submit} aria-labelledby="tab-topic">
      <p className={styles.note}>{t.nameATopicAndAIWill}</p>
      <label className={styles.field}>
        <span>{t.topic}</span>
        <input
          maxLength={80}
          placeholder={t.forExampleAtTheAirportFood}
          value={topic}
          disabled={busy}
          onChange={(event) => {
            setTopic(event.target.value);
            setFork(false);
          }}
        />
      </label>
      <div className={styles.options}>
        <fieldset className={styles.choice}>
          <legend>{t.howManyWords}</legend>
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
          <span>{t.level}</span>
          <select value={level} disabled={busy} onChange={(event) => setLevel(event.target.value)}>
            {LEVELS.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      {fork ? (
        <div ref={forkRef} className={styles.fork} role="group" aria-labelledby="fork-title">
          <p id="fork-title" className={styles.forkTitle}>
            {t.thisIsANewTopicCreate}
          </p>
          <p className={styles.note}>{t.deckIsAboutTopic(topics[0])}</p>
          <div className={styles.forkActions}>
            <PrimaryButton type="button" disabled={busy} aria-busy={busy} onClick={() => void draft('new')}>
              {busy ? t.creating : t.createTheDeck(deckTitleFor(topic))}
            </PrimaryButton>
            <button type="button" className={styles.linkButton} disabled={busy} onClick={() => void draft('here')}>
              {t.addItHereAnyway}
            </button>
          </div>
        </div>
      ) : (
        <PrimaryButton type="submit" disabled={busy || !ready} aria-busy={busy}>
          {busy ? t.pickingWords : t.makeCards(count)}
        </PrimaryButton>
      )}
      <div role="status" className={styles.generateStatus}>
        {busy && <p className={styles.note}>{t.pickingWordsForTheTopicIt}</p>}
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
