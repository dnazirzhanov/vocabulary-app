import { useCallback, useEffect, useRef, useState } from 'react';
import { api, describeError } from '../lib/api.ts';
import type { Knowledge as KnowledgeData, Progress } from '../lib/types.ts';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { Heatmap } from './Consistency.tsx';
import { Decks, Summary } from './Knowledge.tsx';
import styles from './ProgressScreen.module.css';
import { t } from '../i18n/index.ts';

/**
 * «Прогресс» (ADR 0034), read top to bottom: the answer at a glance — words I know, this week's
 * gain, the week's days — then each deck as a card with its goal, then the year's calendar.
 * Settings are behind ⚙, in the corner of every page (ADR 0042).
 */
export function ProgressScreen({ onOpenDeck }: { onOpenDeck: (deckId: string) => void }) {
  const [loaded, setLoaded] = useState<{ progress: Progress; knowledge: KnowledgeData } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(
    () =>
      Promise.all([api.progress(), api.knowledge()]).then(
        ([progress, knowledge]) => setLoaded({ progress, knowledge }),
        (caught: unknown) => setError(describeError(caught)),
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => headingRef.current?.focus(), [loaded]);

  if (error) {
    return (
      <div className={styles.screen}>
        <main className={styles.message}>
          <p role="alert">{error}</p>
          <PrimaryButton
            type="button"
            onClick={() => {
              setError(null);
              void load();
            }}
          >
            {t.tryAgain}
          </PrimaryButton>
        </main>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className={styles.screen}>
        <main className={styles.message} aria-busy="true">
          <p>{t.loading}</p>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <main className={styles.main}>
        <div className={styles.head}>
          <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
            {t.progress}
          </h1>
        </div>
        <Summary data={loaded.knowledge} progress={loaded.progress} onPromiseChanged={() => void load()} />
        <Decks data={loaded.knowledge} onOpenDeck={onOpenDeck} />
        <Heatmap progress={loaded.progress} />
      </main>
    </div>
  );
}
