import { useCallback, useEffect, useRef, useState } from 'react';
import { plural, weeksWord } from '../i18n/plural.ts';
import { api, describeError } from '../lib/api.ts';
import { wordsLabel } from '../lib/pace.ts';
import { relativeDay } from '../lib/relativeDay.ts';
import { courseCounts, currentDeck, lessonDecks, newInSession, nextDueAt, studyLabel } from '../lib/today.ts';
import type { Deck, Pace, Progress, Session } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { CardCounts } from '../today/CardCounts.tsx';
import { CheckIcon, FlameIcon, ForwardIcon, PencilIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { DeckList } from './DeckList.tsx';
import { SuggestionCard } from './SuggestionCard.tsx';
import styles from './HomeScreen.module.css';

type Loaded = {
  decks: Deck[];
  /** Decks in «Мои колоды»: mine and my groups'; null if that count didn't load. */
  library: number | null;
  active: Session | null;
  progress: Progress | null;
  pace: Pace | null;
};

interface HomeScreenProps {
  /** `scope` is the deck a session was started for; null is the whole course. */
  onSession: (session: Session, scope: string | null) => void;
  /** «Мои колоды» (ADR 0019). */
  onOpenLibrary: () => void;
}

/**
 * Home answers "what now?": today's cards across the course in Anki's three numbers, one button
 * that studies them all, and the decks with their own counts underneath; tapping a deck studies
 * it (ADR 0014). The plan and
 * friends live in the navigation around it.
 */
export function HomeScreen({ onSession, onOpenLibrary }: HomeScreenProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { run, busy, error } = useAsyncAction();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // State is only set when the requests settle, never synchronously in the effect.
  const load = useCallback(
    () =>
      Promise.all([api.listDecks(), api.activeSession()])
        .then(async ([decks, active]) => {
          const current = currentDeck(decks);
          // Progress and pace are secondary on this screen: if they fail, home still works.
          const [progress, pace] = await Promise.all([
            api.progress().catch(() => null),
            current ? api.pace(current.id).catch(() => null) : null,
          ]);
          const library = await api.library().then(
            (found) => found.mine.length + found.from_groups.length,
            () => null,
          );
          setLoaded({ decks, library, active: active.session, progress, pace });
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

  const { decks, active, progress, pace } = loaded;
  const current = currentDeck(decks);
  if (!current) {
    return (
      <main className={styles.message}>
        <h1 className={styles.messageTitle}>Колод пока нет</h1>
        <p>Скоро здесь появятся слова для изучения.</p>
      </main>
    );
  }

  const counts = courseCounts(decks);
  const due = counts.learning + counts.review;
  // New words come from decks given to my groups first, then the current level (ADR 0017).
  const sources = lessonDecks(decks);
  const newLeft = sources.some((deck) => deck.introduced_count < deck.word_count);
  const bonus = pace?.bonus ?? false;
  // Too many reviews due: new words wait, so what was learned is not forgotten.
  const blocked = (pace?.blocked_by_reviews ?? false) && due > 0;
  const fresh = newInSession(sources, pace);
  const started = decks.some((deck) => deck.introduced_count > 0);
  const label = active ? 'Продолжить урок' : studyLabel({ due, fresh, started, bonus });
  // One session for everything due on every level, then the current level's new words.
  const study = async () => onSession(active ?? (await api.startStudySession(null)), null);
  // Spelling (ADR 0016): a card for each word learned today; required once, then free practice.
  const learnedToday = progress?.today.new_words ?? 0;
  const spellingToday = progress?.spelling_today ?? { words: 0, done: 0 };
  const spellingLabel =
    learnedToday === 0
      ? null
      : spellingToday.done < spellingToday.words
        ? `Правописание · ${wordsLabel(learnedToday)}`
        : 'Правописание · ещё раз';
  const spell = async () => onSession(active ?? (await api.startSpellingSession()), null);
  // The lesson comes first; once nothing is left to study, spelling takes the main button.
  const primary = label ? { text: label, run: study } : spellingLabel ? { text: spellingLabel, run: spell } : null;
  const upcoming = nextDueAt(decks);
  const nextReview = upcoming ? `Следующее повторение — ${relativeDay(upcoming)}.` : null;
  const nothingLeft = counts.fresh + due === 0;

  // With a lesson in progress the button says «Продолжить урок»; no sentence repeats it.
  let note: string | null;
  if (active) note = null;
  else if (blocked)
    note = `Сначала повторение: ${wordsLabel(due)} ждут. Новые слова вернутся сразу после него — так выученное не забудется.`;
  else if (due > 0)
    note = `Пора повторить ${due}\u00a0${plural(due, { one: 'слово', few: 'слова', many: 'слов' })}, которые вы уже видели.`;
  else if (!newLeft)
    note = nextReview ? `Новых слов в курсе нет. ${nextReview}` : 'Вы познакомились со всеми словами курса.';
  else if (bonus)
    note = `Цель на сегодня выполнена.${nextReview ? ` ${nextReview}` : ''} Можно взять ещё слов — бонусом.`;
  else if (nextReview) note = `${nextReview} А пока можно взять новые слова.`;
  else
    note = `В уроке ${wordsLabel(fresh)} на карточках: вспомните перевод, откройте ответ и оцените, насколько легко было.`;

  const reload = async () => {
    await load();
  };

  return (
    <div className={styles.screen}>
      <header className={styles.topbar}>
        {/* Weeks with the promise kept (ADR 0015); "0 weeks" would only greet newcomers with a zero. */}
        <span className={styles.streak}>
          {progress && progress.streak_weeks > 0 && (
            <>
              <FlameIcon aria-hidden="true" />
              {`${progress.streak_weeks}\u00a0${weeksWord(progress.streak_weeks)} подряд`}
            </>
          )}
        </span>
      </header>
      <main className={styles.main}>
        <div className={styles.layout}>
          <section className={styles.today} aria-labelledby="today-title">
            <h1 id="today-title" ref={headingRef} tabIndex={-1} className={styles.title}>
              {nothingLeft && !active ? 'На сегодня всё' : 'Сегодня'}
            </h1>
            <CardCounts counts={counts} />
            {pace && newLeft && <TodayPlan pace={pace} spelling={progress?.spelling_today ?? null} />}
            {label && spellingLabel && (
              <button type="button" className={styles.spellButton} disabled={busy} onClick={() => run(spell)}>
                <PencilIcon aria-hidden="true" />
                {spellingLabel}
              </button>
            )}
            {note && <p className={styles.note}>{note}</p>}
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
          <div className={styles.deckArea}>
            <DeckList
              decks={decks}
              busy={busy}
              onStart={(deckId) => run(async () => onSession(await api.startStudySession(deckId), deckId))}
            />
            <button type="button" className={styles.libraryLink} onClick={onOpenLibrary}>
              <span className={styles.libraryText}>
                <strong>Мои колоды{loaded.library ? ` · ${loaded.library}` : ''}</strong>
                <span>
                  {loaded.library ? 'Свои колоды и колоды из групп' : 'Создайте свою колоду — слова и карточки с ИИ'}
                </span>
              </span>
              <ForwardIcon className={styles.chevron} aria-hidden="true" />
            </button>
          </div>
        </div>
      </main>
      {(primary || error) && (
        <footer className={styles.actions}>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {primary && (
            <div className={styles.actionsInner}>
              <PrimaryButton
                type="button"
                className={styles.action}
                disabled={busy}
                aria-busy={busy}
                onClick={() => run(primary.run)}
              >
                {busy ? 'Загружаем…' : primary.text}
              </PrimaryButton>
            </div>
          )}
        </footer>
      )}
    </div>
  );
}

/**
 * Today's plan in two parts (ADR 0016): the new words on cards, then their spelling.
 * Done is marked by a tick and words, not colour alone. The warm-up is named so a lower number
 * never looks like a cut.
 */
function TodayPlan({ pace, spelling }: { pace: Pace; spelling: Progress['spelling_today'] | null }) {
  const cardsDone = pace.new_words_today >= pace.effective_target;
  const words = spelling?.words ?? 0;
  const spellingDone = words > 0 && spelling?.done === words;
  return (
    <section className={styles.plan} aria-labelledby="plan-title">
      <h2 id="plan-title" className={styles.planTitle}>
        План на сегодня
      </h2>
      <ul className={styles.planList}>
        <li data-done={cardsDone || undefined}>
          <span className={styles.planMark} aria-hidden="true">
            {cardsDone && <CheckIcon />}
          </span>
          <span className={styles.planName}>Карточки</span>
          <span className={styles.planValue}>
            Новых слов за день: <strong>{pace.new_words_today}</strong> из {pace.effective_target}
            {pace.new_words_today > pace.effective_target && <span className={styles.bonus}> · бонус!</span>}
          </span>
        </li>
        <li data-done={spellingDone || undefined}>
          <span className={styles.planMark} aria-hidden="true">
            {spellingDone && <CheckIcon />}
          </span>
          <span className={styles.planName}>Правописание</span>
          <span className={styles.planValue}>
            {words > 0 ? (
              <>
                <strong>{spelling?.done}</strong> из {wordsLabel(words)}
              </>
            ) : cardsDone ? (
              'нечего повторять'
            ) : (
              'после карточек'
            )}
          </span>
        </li>
      </ul>
      {pace.ramp_week !== null && (
        <p className={styles.targetNote}>
          Разогрев, неделя {pace.ramp_week + 1} из 2: сегодня цель {pace.effective_target} из {pace.target}.
        </p>
      )}
    </section>
  );
}
