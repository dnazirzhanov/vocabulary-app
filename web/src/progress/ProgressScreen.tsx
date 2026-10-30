import { useCallback, useEffect, useRef, useState } from 'react';
import { api, describeError } from '../lib/api.ts';
import type { Knowledge as KnowledgeData, Progress } from '../lib/types.ts';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { Consistency } from './Consistency.tsx';
import { AccountSection, type AccountProps } from '../account/AccountSection.tsx';
import { Knowledge } from './Knowledge.tsx';
import styles from './ProgressScreen.module.css';

/**
 * Two questions, answered at a glance (ADR 0022, 0033): do I actually remember — words learned,
 * and each deck's way to its goal — and am I studying steadily — my week against my own promise,
 * and the year's calendar.
 */
export function ProgressScreen({
  onOpenDeck,
  account,
}: {
  onOpenDeck: (deckId: string) => void;
  /** Sign out and delete my data, at the end of the page. */
  account: AccountProps;
}) {
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
            Повторить
          </PrimaryButton>
        </main>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className={styles.screen}>
        <main className={styles.message} aria-busy="true">
          <p>Загружаем…</p>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <main className={styles.main}>
        <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
          Прогресс
        </h1>
        <Knowledge data={loaded.knowledge} onOpenDeck={onOpenDeck} />
        <Consistency progress={loaded.progress} />
        <AccountSection {...account} />
      </main>
    </div>
  );
}
