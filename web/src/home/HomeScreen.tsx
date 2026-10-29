import { useCallback, useEffect, useRef, useState } from 'react';
import { weeksWord } from '../i18n/plural.ts';
import { api, describeError } from '../lib/api.ts';
import type { Deck } from '../lib/types.ts';
import { FlameIcon, ForwardIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { DeckList } from './DeckList.tsx';
import styles from './HomeScreen.module.css';

type Loaded = {
  decks: Deck[];
  /** Decks in «Мои колоды»: mine and my groups'; null if that count didn't load. */
  library: number | null;
  /** Weeks in a row with the promise kept (ADR 0015); null if progress didn't load. */
  streak: number | null;
};

interface HomeScreenProps {
  /** A deck's page: its stats and its own «Учить» (ADR 0020). */
  onOpenDeck: (deckId: string) => void;
  /** «Мои колоды» (ADR 0019). */
  onOpenLibrary: () => void;
}

/**
 * Home is the course's levels, each with today's cards in Anki's three numbers, and the way to
 * «Мои колоды». Studying happens on a deck's own page (ADR 0020): there is no button that
 * studies everything at once, so it is always clear which deck a lesson is from.
 */
export function HomeScreen({ onOpenDeck, onOpenLibrary }: HomeScreenProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // State is only set when the requests settle, never synchronously in the effect.
  const load = useCallback(
    () =>
      api
        .listDecks()
        .then(async (decks) => {
          // The streak and the library count are secondary: if they fail, home still works.
          const [streak, library] = await Promise.all([
            api.progress().then(
              (progress) => progress.streak_weeks,
              () => null,
            ),
            api.library().then(
              (found) => found.mine.length + found.from_groups.length,
              () => null,
            ),
          ]);
          setLoaded({ decks, library, streak });
        })
        .catch((caught: unknown) => setLoadError(describeError(caught))),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => headingRef.current?.focus(), [loaded]);

  if (loadError) {
    return (
      <main className={styles.message}>
        <p role="alert">{loadError}</p>
        <PrimaryButton
          type="button"
          onClick={() => {
            setLoadError(null);
            void load();
          }}
        >
          Повторить
        </PrimaryButton>
      </main>
    );
  }
  if (!loaded) {
    return (
      <main className={styles.message} aria-busy="true">
        <p>Загружаем…</p>
      </main>
    );
  }
  const { decks, library, streak } = loaded;
  if (decks.length === 0) {
    return (
      <main className={styles.message}>
        <h1 className={styles.messageTitle}>Колод пока нет</h1>
        <p>Скоро здесь появятся слова для изучения.</p>
      </main>
    );
  }

  return (
    <div className={styles.screen}>
      <header className={styles.topbar}>
        {/* Weeks with the promise kept (ADR 0015); "0 weeks" would only greet newcomers with a zero. */}
        <span className={styles.streak}>
          {streak !== null && streak > 0 && (
            <>
              <FlameIcon aria-hidden="true" />
              {`${streak}\u00a0${weeksWord(streak)} подряд`}
            </>
          )}
        </span>
      </header>
      <main className={styles.main}>
        <div className={styles.layout}>
          <h1 ref={headingRef} tabIndex={-1} className="visually-hidden">
            Колоды
          </h1>
          <div className={styles.deckArea}>
            <DeckList decks={decks} busy={false} onStart={onOpenDeck} />
            <button type="button" className={styles.libraryLink} onClick={onOpenLibrary}>
              <span className={styles.libraryText}>
                <strong>Мои колоды{library ? ` · ${library}` : ''}</strong>
                <span>
                  {library ? 'Свои колоды и колоды из групп' : 'Создайте свою колоду — слова и карточки с ИИ'}
                </span>
              </span>
              <ForwardIcon className={styles.chevron} aria-hidden="true" />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
