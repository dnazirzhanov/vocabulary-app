import { useEffect, useRef, useState } from 'react';
import { api, describeError } from '../lib/api.ts';
import { DEFAULT_SECONDS_PER_EXERCISE } from '../lib/pace.ts';
import type { Deck, Me } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { BackIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { SecondaryButton } from '../ui/SecondaryButton.tsx';
import { PlanControls } from './PlanControls.tsx';
import { planInput, type PaceChoice } from './planInput.ts';
import { PlanView } from './PlanView.tsx';
import styles from './Plan.module.css';

interface Loaded {
  deck: Deck;
  me: Me;
  metToday: number;
  seconds: number;
}

const choiceOf = (me: Me): PaceChoice => ({
  words: me.daily_target_words ?? 5,
  days: me.study_days_per_week,
  ramp: me.ramp_enabled,
});

/** «План»: try a pace and see, day by day, how many words it gets you and when the goal is reached. */
export function PlanScreen({
  deckId,
  onBack,
  onSaved,
}: {
  deckId: string;
  onBack: () => void;
  onSaved: (me: Me) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<PaceChoice | null>(null);
  const { run, busy, error: saveError } = useAsyncAction();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // Fresh counts: the plan starts from what the learner knows right now.
    void Promise.all([api.listDecks(), api.me(), api.pace(deckId).catch(() => null)]).then(
      ([decks, me, pace]) => {
        const deck = decks.find((candidate) => candidate.id === deckId);
        if (!deck) return setError('Колода не найдена.');
        setLoaded({
          deck,
          me,
          metToday: pace?.new_words_today ?? 0,
          seconds: pace?.seconds_per_exercise ?? DEFAULT_SECONDS_PER_EXERCISE,
        });
        setChoice(choiceOf(me));
      },
      (caught: unknown) => setError(describeError(caught)),
    );
  }, [deckId]);
  useEffect(() => {
    if (loaded) headingRef.current?.focus();
  }, [loaded]);

  if (error) {
    return (
      <main className="message-screen">
        <p role="alert">{error}</p>
      </main>
    );
  }
  if (!loaded || !choice) {
    return (
      <main className="message-screen" aria-busy="true">
        <p>Загружаем…</p>
      </main>
    );
  }

  const saved = choiceOf(loaded.me);
  const changed = choice.words !== saved.words || choice.days !== saved.days || choice.ramp !== saved.ramp;
  return (
    <div className={styles.screen}>
      <header className={styles.topbar}>
        <button type="button" className={styles.back} onClick={onBack}>
          <BackIcon aria-hidden="true" /> На главную
        </button>
      </header>
      <main className={styles.main}>
        <div className={styles.column}>
          <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
            Ваш план
          </h1>
          <PlanView
            input={planInput(loaded.deck, choice, loaded.metToday, loaded.me.onboarded_at)}
            deckWords={loaded.deck.word_count}
            controls={<PlanControls value={choice} onChange={setChoice} secondsPerExercise={loaded.seconds} />}
          />
        </div>
      </main>
      {changed && (
        <footer className={styles.saveBar}>
          {saveError && (
            <p className={styles.problem} role="alert">
              {saveError}
            </p>
          )}
          <div className={styles.saveInner}>
            <SecondaryButton type="button" onClick={() => setChoice(saved)} disabled={busy}>
              Как было
            </SecondaryButton>
            <PrimaryButton
              type="button"
              disabled={busy}
              aria-busy={busy}
              onClick={() =>
                run(async () => {
                  const me = await api.updateMe({
                    daily_target_words: choice.words,
                    study_days_per_week: choice.days,
                    ramp_enabled: choice.ramp,
                  });
                  setLoaded({ ...loaded, me });
                  onSaved(me);
                })
              }
            >
              {busy ? 'Сохраняем…' : `Сохранить: ${choice.words} в день`}
            </PrimaryButton>
          </div>
        </footer>
      )}
    </div>
  );
}
