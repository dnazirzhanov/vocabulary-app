import { useCallback, useEffect, useRef, useState } from 'react';
import { plural } from '../i18n/plural.ts';
import { Illustration } from '../illustrations/index.tsx';
import { api, describeError } from '../lib/api.ts';
import { wordsLabel } from '../lib/pace.ts';
import type { Deck, Pace, Progress, Session } from '../lib/types.ts';
import { relativeDay } from '../lib/relativeDay.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { ChartIcon, FlameIcon, TargetIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { SecondaryButton } from '../ui/SecondaryButton.tsx';
import styles from './HomeScreen.module.css';
import { SuggestionCard } from './SuggestionCard.tsx';

type Loaded = { deck: Deck | undefined; active: Session | null; progress: Progress | null; pace: Pace | null };
type Action = { label: string; run: () => Promise<void> };

interface HomeScreenProps {
  onSession: (session: Session) => void;
  onProgress: (deckId: string) => void;
  onGoal: () => void;
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

export function HomeScreen({ onSession, onProgress, onGoal }: HomeScreenProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { run, busy, error } = useAsyncAction();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // State is only set when the requests settle, never synchronously in the effect.
  const load = useCallback(
    () =>
      Promise.all([api.listDecks(), api.activeSession()])
        .then(async ([decks, active]) => {
          const deck = decks[0];
          // Progress and pace are secondary on this screen: if they fail, home still works.
          const [progress, pace] = deck
            ? await Promise.all([api.deckProgress(deck.id).catch(() => null), api.pace(deck.id).catch(() => null)])
            : [null, null];
          setLoaded({ deck, active: active.session, progress, pace });
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

  const { deck, active, progress, pace } = loaded;
  if (!deck) {
    return (
      <main className={styles.message}>
        <h1 className={styles.messageTitle}>Колод пока нет</h1>
        <p>Скоро здесь появятся слова для изучения.</p>
      </main>
    );
  }

  const met = deck.introduced_count;
  const due = deck.due_count;
  const newLeft = met < deck.word_count;
  // The daily target sizes lessons; after it, lessons are a bonus (ADR 0010).
  const lessonSize = Math.min(pace?.next_lesson_size ?? 5, deck.word_count - met);
  const bonus = pace?.bonus ?? false;
  // Too many reviews due: new words wait, so what was learned is not forgotten.
  const blocked = (pace?.blocked_by_reviews ?? false) && due > 0;
  const startNew: Action = {
    label:
      met === 0
        ? `Начать урок · ${wordsLabel(lessonSize)}`
        : bonus
          ? `Ещё ${wordsLabel(lessonSize)}`
          : `Новые слова · ${lessonSize}`,
    run: async () => onSession(await api.startNewSession(deck.id)),
  };
  // Due reviews come first; new words stay one tap away unless the review backlog is too big.
  let primary: Action | null = newLeft ? startNew : null;
  let secondary: Action | null = null;
  if (active) {
    primary = { label: 'Продолжить урок', run: async () => onSession(active) };
  } else if (due > 0) {
    primary = {
      label: `Повторить слова · ${due}`,
      run: async () => onSession(await api.startReviewSession(deck.id)),
    };
    secondary = newLeft && !blocked ? startNew : null;
  }

  const nextReview = deck.next_due_at ? `Следующее повторение — ${relativeDay(deck.next_due_at)}.` : null;
  let note: string;
  if (active) note = 'Урок не закончен — продолжите с того же места.';
  else if (blocked)
    note = `Сначала повторение: ${wordsLabel(due)} ждут. Новые слова вернутся сразу после него — так выученное не забудется.`;
  else if (due > 0)
    note = `Пора повторить ${due}\u00a0${plural(due, { one: 'слово', few: 'слова', many: 'слов' })}, которые вы уже видели.`;
  else if (!newLeft)
    note = nextReview ? `Новых слов в колоде нет. ${nextReview}` : 'Вы познакомились со всеми словами этой колоды.';
  else if (bonus)
    note = `Цель на сегодня выполнена.${nextReview ? ` ${nextReview}` : ''} Можно взять ещё слов — бонусом.`;
  else if (nextReview) note = `${nextReview} А пока можно взять новые слова.`;
  else note = `В уроке ${wordsLabel(lessonSize)}: знакомство, выбор перевода и написание.`;

  const reload = async () => {
    await load();
  };

  return (
    <div className={styles.screen}>
      <header className={styles.topbar}>
        {/* A streak appears once there is one; "0 days" would only greet newcomers with a zero. */}
        <span className={styles.streak}>
          {progress && progress.streak_days > 0 && (
            <>
              <FlameIcon aria-hidden="true" />
              {`${progress.streak_days}\u00a0${plural(progress.streak_days, { one: 'день', few: 'дня', many: 'дней' })} подряд`}
            </>
          )}
        </span>
        <nav className={styles.links} aria-label="Разделы">
          <button type="button" className={styles.progressLink} onClick={onGoal}>
            <TargetIcon aria-hidden="true" /> Цель
          </button>
          <button type="button" className={styles.progressLink} onClick={() => onProgress(deck.id)}>
            <ChartIcon aria-hidden="true" /> Прогресс
          </button>
        </nav>
      </header>
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
            {pace && newLeft && <TodayPlan pace={pace} />}
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
            <p className={styles.note}>{note}</p>
            {pace?.suggestion && !active && (
              <div className={styles.suggestion}>
                <SuggestionCard
                  suggestion={pace.suggestion}
                  target={pace.target}
                  onAccept={async (value) => {
                    await api.updateMe({ daily_target_words: value });
                    await reload();
                  }}
                  onDismiss={async () => {
                    await api.dismissSuggestion(pace.suggestion!.kind);
                    await reload();
                  }}
                />
              </div>
            )}
          </section>
        </div>
      </main>
      {primary && (
        <footer className={styles.actions}>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.actionsInner}>
            {secondary && (
              <SecondaryButton
                type="button"
                className={`${styles.action} ${styles.secondary}`}
                disabled={busy}
                onClick={() => run(secondary.run)}
              >
                {secondary.label}
              </SecondaryButton>
            )}
            <PrimaryButton
              type="button"
              className={styles.action}
              disabled={busy}
              aria-busy={busy}
              onClick={() => run(primary.run)}
            >
              {busy ? 'Загружаем…' : primary.label}
            </PrimaryButton>
          </div>
        </footer>
      )}
    </div>
  );
}

/** Today's share of the daily target; the ramp is named so a lower number never looks like a cut. */
function TodayPlan({ pace }: { pace: Pace }) {
  const done = Math.min(pace.new_words_today, pace.effective_target);
  return (
    <div className={styles.today}>
      <p className={styles.todayValue}>
        Сегодня: <strong>{pace.new_words_today}</strong> из {wordsLabel(pace.effective_target)}
        {pace.new_words_today > pace.effective_target && <span className={styles.bonus}> · бонус!</span>}
      </p>
      <div className={styles.todayDots} aria-hidden="true">
        <span style={{ width: `${(done / pace.effective_target) * 100}%` }} />
      </div>
      {pace.ramp_week !== null && (
        <p className={styles.todayNote}>
          Разогрев, неделя {pace.ramp_week + 1} из 2: сегодня цель {pace.effective_target} из {pace.target}.
        </p>
      )}
    </div>
  );
}
