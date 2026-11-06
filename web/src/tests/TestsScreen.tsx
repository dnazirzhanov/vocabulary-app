import { useCallback, useEffect, useRef, useState } from 'react';
import { api, describeError } from '../lib/api.ts';
import { scoreText, verdictText } from '../lib/groupTests.ts';
import type { GroupTests, TestDeck } from '../lib/types.ts';
import { BackIcon, ForwardIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import shared from '../groups/Groups.module.css';
import styles from './Tests.module.css';

function deckNote(deck: TestDeck): string | null {
  if (deck.mine) {
    const score = `${scoreText(deck.mine)} · ${verdictText(deck.mine.passed)}`;
    return deck.can_start ? `${score} · Открыт снова` : score;
  }
  return deck.is_open ? 'Открыт' : null;
}

/** The group's decks, to choose which test (ADR 0046). */
export function TestsScreen(props: { groupId: string; onOpen: (deckId: string) => void; onBack: () => void }) {
  const { groupId, onOpen, onBack } = props;
  const [tests, setTests] = useState<GroupTests | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const load = useCallback(
    () => api.groupTests(groupId).then(setTests, (caught: unknown) => setError(describeError(caught))),
    [groupId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const ready = tests !== null;
  useEffect(() => {
    if (ready) headingRef.current?.focus();
  }, [ready]);

  if (error) {
    return (
      <main className="message-screen">
        <p role="alert">{error}</p>
        <PrimaryButton type="button" onClick={() => (setError(null), void load())}>
          Повторить
        </PrimaryButton>
      </main>
    );
  }
  if (!tests) {
    return (
      <main className="message-screen" aria-busy="true">
        <p>Загружаем…</p>
      </main>
    );
  }
  return (
    <div className={shared.screen}>
      <header className={shared.topbar}>
        <button type="button" className={shared.back} onClick={onBack}>
          <BackIcon aria-hidden="true" /> К группе
        </button>
      </header>
      <main className={shared.main}>
        <div className={shared.column}>
          <h1 ref={headingRef} tabIndex={-1} className={shared.title}>
            Тесты
          </h1>
          {tests.decks.length === 0 ? (
            <p className={shared.lead}>Тестов пока нет.</p>
          ) : (
            <ul className={styles.decks}>
              {tests.decks.map((deck) => {
                const note = deckNote(deck);
                return (
                  <li key={deck.deck_id}>
                    <button type="button" className={styles.deck} onClick={() => onOpen(deck.deck_id)}>
                      <span>
                        <strong>{deck.title}</strong>
                        {note && <small>{note}</small>}
                      </span>
                      <ForwardIcon aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
