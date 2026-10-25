import { useCallback, useEffect, useRef, useState } from 'react';
import { plural } from '../i18n/plural.ts';
import { Illustration } from '../illustrations/index.tsx';
import { api, describeError } from '../lib/api.ts';
import type { Deck, Session } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './HomeScreen.module.css';

type Loaded = { deck: Deck | undefined; active: Session | null };

interface HomeScreenProps {
  onSession: (session: Session) => void;
}

/** Decorative cover for the deck: a few everyday objects in the house illustration style. */
function DeckArt() {
  return (
    <div className={styles.art} aria-hidden="true">
      <Illustration id="umbrella" className={styles.artLeft} />
      <Illustration id="kettle" className={styles.artRight} />
      <Illustration id="key" className={styles.artCenter} />
    </div>
  );
}

export function HomeScreen({ onSession }: HomeScreenProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { run, busy, error } = useAsyncAction();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // State is only set when the requests settle, never synchronously in the effect.
  const load = useCallback(
    () =>
      Promise.all([api.listDecks(), api.activeSession()]).then(
        ([decks, active]) => setLoaded({ deck: decks[0], active: active.session }),
        (caught: unknown) => setLoadError(describeError(caught)),
      ),
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

  const { deck, active } = loaded;
  if (!deck) {
    return (
      <main className={styles.message}>
        <h1 className={styles.messageTitle}>Колод пока нет</h1>
        <p>Скоро здесь появятся слова для изучения.</p>
      </main>
    );
  }

  const met = deck.introduced_count;
  const finished = met >= deck.word_count && !active;
  const start = active
    ? { label: 'Продолжить урок', action: async () => onSession(active) }
    : {
        label: met === 0 ? 'Начать урок' : 'Следующие слова',
        action: async () => onSession(await api.startNewSession(deck.id)),
      };

  return (
    <div className={styles.screen}>
      <main className={styles.main}>
        <div className={styles.layout}>
          <div className={styles.stage}>
            <DeckArt />
          </div>
          <div className={styles.intro}>
            <p className={styles.eyebrow}>Колода</p>
            <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
              {deck.title}
            </h1>
            <p className={styles.description}>{deck.description}</p>
          </div>
          <section className={styles.progress} aria-labelledby="deck-progress">
            <h2 id="deck-progress" className={styles.progressLabel}>
              Вы познакомились
            </h2>
            <p className={styles.progressValue}>
              <strong>{met}</strong> из {deck.word_count}&nbsp;
              {plural(deck.word_count, { one: 'слова', few: 'слов', many: 'слов' })}
            </p>
            <div
              className={styles.track}
              role="progressbar"
              aria-labelledby="deck-progress"
              aria-valuemin={0}
              aria-valuemax={deck.word_count}
              aria-valuenow={met}
              aria-valuetext={`${met} из ${deck.word_count}`}
            >
              <div className={styles.fill} style={{ width: `${(met / deck.word_count) * 100}%` }} />
            </div>
            <p className={styles.note}>
              {active
                ? 'Урок не закончен — продолжите с того же места.'
                : finished
                  ? 'Вы познакомились со всеми словами этой колоды.'
                  : 'В уроке 5 новых слов: знакомство, выбор перевода и написание.'}
            </p>
          </section>
        </div>
      </main>
      {!finished && (
        <footer className={styles.actions}>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actionsInner}>
            <PrimaryButton
              type="button"
              className={styles.action}
              disabled={busy}
              aria-busy={busy}
              onClick={() => run(start.action)}
            >
              {busy ? 'Загружаем…' : start.label}
            </PrimaryButton>
          </div>
        </footer>
      )}
    </div>
  );
}
