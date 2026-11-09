import { useCallback, useEffect, useRef, useState } from 'react';
import { api, describeError } from '../lib/api.ts';
import { withSnapshot } from '../local/session.ts';
import type { Deck } from '../lib/types.ts';
import { BackIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { DeckList } from './DeckList.tsx';
import styles from './CourseScreen.module.css';
import { t } from '../i18n/index.ts';

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
    // Without a connection, the levels as last seen: each level's page is worked out on the device.
    () =>
      withSnapshot('courseDecks', () => api.listDecks()).then(
        ({ value }) => setDecks(value),
        (caught: unknown) => setLoadError(describeError(caught)),
      ),
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
          {t.tryAgain}
        </PrimaryButton>
      </main>
    );
  }
  if (!decks) {
    return (
      <main className={styles.message} aria-busy="true">
        <p>{t.loading}</p>
      </main>
    );
  }

  return (
    <div className={styles.screen}>
      <header className={styles.topbar}>
        <button type="button" className={styles.back} onClick={onBack}>
          <BackIcon aria-hidden="true" /> {t.myDecks}
        </button>
      </header>
      <main className={styles.main}>
        <div className={styles.layout}>
          <div className={styles.intro}>
            <h1 ref={headingRef} tabIndex={-1} className={styles.pageTitle}>
              {t.englishByLevels}
            </h1>
            <p className={styles.lead}>{t.theMostUsefulEnglishWordsFrom}</p>
          </div>
          {decks.length === 0 ? (
            <p className={styles.lead}>{t.levelsWillAppearHereSoon}</p>
          ) : (
            <DeckList decks={decks} busy={false} onStart={onOpenDeck} />
          )}
        </div>
      </main>
    </div>
  );
}
