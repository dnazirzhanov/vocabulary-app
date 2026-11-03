import { useCallback, useEffect, useRef, useState } from 'react';
import { api, describeError } from '../lib/api.ts';
import type { Knowledge as KnowledgeData, Progress } from '../lib/types.ts';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { Heatmap } from './Consistency.tsx';
import { AccountSection, type AccountProps } from '../account/AccountSection.tsx';
import { Decks, Summary } from './Knowledge.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { GearIcon } from '../ui/icons.tsx';
import styles from './ProgressScreen.module.css';

/**
 * «Прогресс» (ADR 0034), read top to bottom: the answer at a glance — words I know, this week's
 * gain, the week's days — then each deck as a card with its goal, then the year's calendar.
 * Settings are behind ⚙, not on the page.
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
  const [settings, setSettings] = useState(false);
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
        <div className={styles.head}>
          <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
            Прогресс
          </h1>
          <button
            type="button"
            className={styles.settings}
            onClick={() => setSettings(true)}
            aria-label="Настройки"
            title="Настройки"
          >
            <GearIcon aria-hidden="true" />
          </button>
        </div>
        <Summary data={loaded.knowledge} progress={loaded.progress} onPromiseChanged={() => void load()} />
        <Decks data={loaded.knowledge} onOpenDeck={onOpenDeck} />
        <Heatmap progress={loaded.progress} />
      </main>
      <Dialog open={settings} onClose={() => setSettings(false)} title="Настройки">
        <AccountSection {...account} />
      </Dialog>
    </div>
  );
}
