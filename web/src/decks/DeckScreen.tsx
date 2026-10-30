import { useCallback, useEffect, useRef, useState } from 'react';
import { api, describeError } from '../lib/api.ts';
import { wordsLabel } from '../lib/pace.ts';
import { relativeDay } from '../lib/relativeDay.ts';
import { studyLabel } from '../lib/today.ts';
import type { DeckStats, Pace, Session } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { SuggestionCard } from '../home/SuggestionCard.tsx';
import { PausedSpelling } from '../spelling/PausedSpelling.tsx';
import { SpellingModes } from '../spelling/SpellingModes.tsx';
import { CardCounts } from '../today/CardCounts.tsx';
import { BackIcon, ForwardIcon, PencilIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './DeckScreen.module.css';

type Loaded = { stats: DeckStats; active: Session | null; activeTitle: string | null; pace: Pace | null };

interface DeckScreenProps {
  deckId: string;
  backLabel: string;
  onBack: () => void;
  /** A session started or resumed from here; `deckId` is the deck it belongs to. */
  onSession: (session: Session, deckId: string) => void;
  onWords: (deckId: string, title: string) => void;
  onEdit: (deckId: string) => void;
}

/**
 * A deck's page (ADR 0020): where I am with it — words met and remembered well, today's cards in
 * Anki's three numbers — and one button that studies this deck, within today's pace.
 */
export function DeckScreen({ deckId, backLabel, onBack, onSession, onWords, onEdit }: DeckScreenProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modesOpen, setModesOpen] = useState(false);
  const { run, busy, error } = useAsyncAction();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(
    () =>
      Promise.all([api.deckStats(deckId), api.activeSession()])
        .then(async ([stats, active]) => {
          // The pace (its suggestion, the review brake) is secondary: the page works without it.
          const pace = await api.pace(deckId).catch(() => null);
          const session = active.session;
          const activeTitle =
            session && session.deck_id !== deckId
              ? await api.deckStats(session.deck_id).then(
                  (other) => other.title,
                  () => null,
                )
              : null;
          setLoaded({ stats, active: session, activeTitle, pace });
        })
        .catch((caught: unknown) => setLoadError(describeError(caught))),
    [deckId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const focused = useRef(false);
  useEffect(() => {
    if (!loaded || focused.current) return;
    focused.current = true;
    headingRef.current?.focus();
  }, [loaded]);

  if (loadError) {
    return (
      <main className="message-screen">
        <p role="alert">{loadError}</p>
        <PrimaryButton type="button" onClick={() => (setLoadError(null), void load())}>
          Повторить
        </PrimaryButton>
      </main>
    );
  }
  if (!loaded) {
    return (
      <main className="message-screen" aria-busy="true">
        <p>Загружаем…</p>
      </main>
    );
  }

  const { stats, active, activeTitle, pace } = loaded;
  const due = stats.learning_count + stats.review_count;
  // An unfinished lesson: in this deck it is resumed here; elsewhere it is finished first. An
  // unfinished spelling is not a lesson: it waits beside it, on its own card (ADR 0026).
  const resumeHere = active !== null && active.deck_id === deckId;
  const elsewhere = active !== null && !resumeHere;
  const blocked = (pace?.blocked_by_reviews ?? false) && due > 0;
  const left = stats.word_count - stats.introduced_count;
  // Today's pace done but words left: a bonus lesson is still there to take (ADR 0010).
  const bonus = stats.new_today === 0 && left > 0 && !stats.locked && !blocked && (pace?.bonus ?? false);
  const fresh = bonus ? Math.min(pace?.next_lesson_size ?? 0, left) : stats.new_today;
  const label = resumeHere ? 'Продолжить урок' : studyLabel({ due, fresh, started: stats.introduced_count > 0, bonus });
  const nextReview = stats.next_due_at ? `Следующее повторение — ${relativeDay(stats.next_due_at)}.` : null;
  let note: string | null = null;
  if (stats.locked) note = 'Этот уровень откроется, когда вы встретите все слова предыдущего.';
  else if (elsewhere) note = `Сначала закончите начатый урок${activeTitle ? ` в колоде «${activeTitle}»` : ''}.`;
  else if (blocked) note = `Сначала повторение: ${wordsLabel(due)} ждут. Новые слова вернутся сразу после него.`;
  else if (bonus && due === 0) note = 'Цель на сегодня выполнена. Можно взять ещё слов — бонусом.';
  else if (!label)
    note =
      stats.introduced_count < stats.word_count
        ? `На сегодня новых слов хватит — темп выполнен.${nextReview ? ` ${nextReview}` : ''}`
        : nextReview
          ? `Все слова колоды встречены. ${nextReview}`
          : 'Все слова колоды встречены.';
  const source = stats.is_mine
    ? 'Ваша колода'
    : stats.author
      ? `от ${stats.author} · ${stats.group_name}`
      : (stats.group_name ?? stats.level);
  // Spelling (ADR 0026): the main button takes due hard words and words never spelled; the other
  // sets are one tap further, under «Другие режимы».
  const spelling = stats.spelling_today;
  const unwritten = Math.max(0, spelling.ready - spelling.due);
  const spellingNote =
    spelling.due > 0 && unwritten > 0
      ? `${spelling.due} на повторение и ${unwritten} новых`
      : spelling.due > 0
        ? `${wordsLabel(spelling.due)} на повторение`
        : 'Слова, которые вы ещё не писали';
  const share = (part: number) => `${stats.word_count ? (part / stats.word_count) * 100 : 0}%`;

  return (
    <div className={styles.screen}>
      <header className={styles.topbar}>
        <button type="button" className={styles.back} onClick={onBack}>
          <BackIcon aria-hidden="true" /> {backLabel}
        </button>
      </header>
      <main className={styles.main}>
        <div className={styles.column}>
          <div className={styles.head}>
            {source && <p className={styles.eyebrow}>{source}</p>}
            <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
              {stats.title}
            </h1>
          </div>

          <section className={styles.progress} aria-labelledby="deck-progress">
            <h2 id="deck-progress" className="visually-hidden">
              Прогресс по колоде
            </h2>
            <p className={styles.figure}>
              <strong>{stats.introduced_count}</strong> из {wordsLabel(stats.word_count)} встречено
            </p>
            <div
              className={styles.bar}
              role="progressbar"
              aria-label="Встречено слов"
              aria-valuemin={0}
              aria-valuemax={stats.word_count}
              aria-valuenow={stats.introduced_count}
            >
              <span className={styles.barMet} style={{ width: share(stats.introduced_count) }} />
              <span className={styles.barKnown} style={{ width: share(stats.well_learned) }} />
            </div>
            <p className={styles.legend}>
              <span className={styles.keyKnown} aria-hidden="true" /> помню хорошо: {stats.well_learned}
              <span className={styles.keyMet} aria-hidden="true" /> встречено: {stats.introduced_count}
            </p>
          </section>

          <section className={styles.today} aria-labelledby="deck-today">
            <h2 id="deck-today" className={styles.sectionTitle}>
              Сегодня в колоде
            </h2>
            <CardCounts
              counts={{ fresh: stats.new_today, learning: stats.learning_count, review: stats.review_count }}
            />
            {note && <p className={styles.note}>{note}</p>}
            {pace?.ramp_week != null && !stats.locked && (
              <p className={styles.note}>
                Разогрев, неделя {pace.ramp_week + 1} из 2: сегодня цель {pace.effective_target} из {pace.target}.
              </p>
            )}
          </section>

          {pace?.suggestion && !active && (
            <SuggestionCard
              suggestion={pace.suggestion}
              target={pace.target}
              onAccept={async (value) => {
                await api.updateMe({ daily_target_words: value });
                await load();
              }}
              onDismiss={async () => {
                await api.dismissSuggestion(pace.suggestion!.kind);
                await load();
              }}
            />
          )}

          <nav className={styles.links} aria-label="Ещё по колоде">
            {spelling.paused && (
              <div className={styles.paused}>
                <PausedSpelling
                  paused={spelling.paused}
                  disabled={busy}
                  onResume={() => run(async () => onSession(await api.startSpellingSession(), deckId))}
                />
              </div>
            )}
            {spelling.ready > 0 && !spelling.paused && (
              <button
                type="button"
                className={styles.link}
                disabled={busy}
                onClick={() => run(async () => onSession(await api.startSpellingSession(), deckId))}
                aria-label={`Правописание · ${wordsLabel(spelling.ready)}`}
                aria-describedby="spelling-note"
              >
                <PencilIcon aria-hidden="true" />
                <span>
                  <strong>Правописание · {wordsLabel(spelling.ready)}</strong>
                  <small id="spelling-note">{spellingNote} — из любой колоды</small>
                </span>
                <ForwardIcon className={styles.chevron} aria-hidden="true" />
              </button>
            )}
            {spelling.met > 0 && !spelling.paused && (
              <button
                type="button"
                className={styles.link}
                onClick={() => setModesOpen(true)}
                aria-label={spelling.ready > 0 ? 'Правописание: другие режимы' : 'Правописание'}
                aria-describedby="spelling-modes-note"
                aria-haspopup="dialog"
              >
                {/* Under the main button, its text lines up with that button's. */}
                {spelling.ready === 0 ? <PencilIcon aria-hidden="true" /> : <span className={styles.iconSpace} />}
                <span>
                  <strong>{spelling.ready > 0 ? 'Правописание: другие режимы' : 'Правописание'}</strong>
                  <small id="spelling-modes-note">
                    {spelling.ready > 0
                      ? 'Сегодняшние, трудные или вразброс'
                      : 'На сегодня всё написано · сегодняшние, трудные или вразброс'}
                  </small>
                </span>
                <ForwardIcon className={styles.chevron} aria-hidden="true" />
              </button>
            )}
            <button type="button" className={styles.link} onClick={() => onWords(deckId, stats.title)}>
              <span>
                <strong>Все слова колоды</strong>
                <small>С вашим прогрессом по каждому</small>
              </span>
              <ForwardIcon className={styles.chevron} aria-hidden="true" />
            </button>
            {stats.is_mine && (
              <button type="button" className={styles.link} onClick={() => onEdit(deckId)}>
                <span>
                  <strong>Изменить колоду</strong>
                  <small>Добавить карточки, дать группе</small>
                </span>
                <ForwardIcon className={styles.chevron} aria-hidden="true" />
              </button>
            )}
          </nav>
          {modesOpen && (
            <SpellingModes
              open
              state={spelling}
              onClose={() => setModesOpen(false)}
              onStart={async (mode, size) => onSession(await api.startSpellingSession(mode, size), deckId)}
            />
          )}
        </div>
      </main>
      <footer className={styles.actions}>
        <div className={styles.actionsInner}>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {elsewhere && active ? (
            <PrimaryButton type="button" className={styles.action} onClick={() => onSession(active, active.deck_id)}>
              Продолжить начатый урок
            </PrimaryButton>
          ) : (
            <PrimaryButton
              type="button"
              className={styles.action}
              disabled={busy || stats.locked || !label}
              aria-busy={busy}
              onClick={() => run(async () => onSession(active ?? (await api.startStudySession(deckId)), deckId))}
            >
              {busy ? 'Загружаем…' : (label ?? 'На сегодня всё')}
            </PrimaryButton>
          )}
        </div>
      </footer>
    </div>
  );
}
