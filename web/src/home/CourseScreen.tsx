import { useCallback, useEffect, useRef, useState } from 'react';
import { api, describeError } from '../lib/api.ts';
import type { Deck } from '../lib/types.ts';
import { BackIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { DeckList } from './DeckList.tsx';
import styles from './CourseScreen.module.css';

interface CourseScreenProps {
  /** A level's page: its stats and its own «Учить» (ADR 0020). */
  onOpenDeck: (deckId: string) => void;
  onBack: () => void;
}

/**
 * The course (ADR 0021): English words level by level, each level with today's cards in Anki's
 * three numbers; a later level opens when the one before is met (ADR 0014). Reached from home,
 * where the learner's own decks come first.
 */
export function CourseScreen({ onOpenDeck, onBack }: CourseScreenProps) {
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(
    () => api.listDecks().then(setDecks, (caught: unknown) => setLoadError(describeError(caught))),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => headingRef.current?.focus(), [decks]);

  if (loadError) {
    return (
      <main className={styles.message}>
        <p role="alert">{loadError}</p>
        <PrimaryButton type="button" onClick={() => (setLoadError(null), void load())}>
          Повторить
        </PrimaryButton>
      </main>
    );
  }
  if (!decks) {
    return (
      <main className={styles.message} aria-busy="true">
        <p>Загружаем…</p>
      </main>
    );
  }

  return (
    <div className={styles.screen}>
      <header className={styles.topbar}>
        <button type="button" className={styles.back} onClick={onBack}>
          <BackIcon aria-hidden="true" /> Мои колоды
        </button>
      </header>
      <main className={styles.main}>
        <div className={styles.layout}>
          <div className={styles.intro}>
            <h1 ref={headingRef} tabIndex={-1} className={styles.pageTitle}>
              Английский по уровням
            </h1>
            <p className={styles.lead}>
              Самые нужные слова английского, от простых к сложным. Откройте уровень — новые слова придут в вашем темпе,
              а повторения напомнят о выученных. Следующий уровень откроется, когда пройдёте этот.
            </p>
          </div>
          {decks.length === 0 ? (
            <p className={styles.lead}>Скоро здесь появятся уровни.</p>
          ) : (
            <DeckList decks={decks} busy={false} onStart={onOpenDeck} />
          )}
        </div>
      </main>
    </div>
  );
}
