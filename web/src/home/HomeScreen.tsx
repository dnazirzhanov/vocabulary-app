import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, describeError } from '../lib/api.ts';
import { deadlineLeft, localToday } from '../lib/deadline.ts';
import { wordsLabel } from '../lib/pace.ts';
import type { Library, LibraryDeck } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { FlameIcon, ForwardIcon, PencilIcon, PlusIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './HomeScreen.module.css';
import { t } from '../i18n/index.ts';

interface HomeScreenProps {
  /** A deck's page: its stats and its own «Учить» (ADR 0020). */
  onOpenPage: (deckId: string) => void;
  /** My deck's editor. */
  onOpenDeck: (deckId: string) => void;
  /** The course: English words level by level. */
  onOpenCourse?: () => void;
}

/**
 * Home is «Мои колоды» (ADR 0021): making a deck first, then the decks I wrote and the decks my
 * groups were given; each opens its page (ADR 0020). The course, level by level, is offered
 * below it, one tap away.
 */
export function HomeScreen({ onOpenPage, onOpenDeck, onOpenCourse }: HomeScreenProps) {
  const [library, setLibrary] = useState<Library | null>(null);
  // Weeks with the promise kept (ADR 0015); secondary, so home works without it.
  const [streak, setStreak] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [title, setTitle] = useState('');
  const { run, busy, error } = useAsyncAction();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameField = useRef<HTMLInputElement>(null);

  const load = useCallback(
    () => api.library().then(setLibrary, (caught: unknown) => setLoadError(describeError(caught))),
    [],
  );
  useEffect(() => {
    void load();
    api.progress().then(
      (progress) => setStreak(progress.streak_weeks),
      () => setStreak(null),
    );
  }, [load]);
  const focused = useRef(false);
  useEffect(() => {
    if (!library || focused.current) return;
    focused.current = true;
    headingRef.current?.focus();
  }, [library]);
  useEffect(() => {
    if (naming) nameField.current?.focus();
  }, [naming]);

  if (loadError) {
    return (
      <main className="message-screen">
        <p role="alert">{loadError}</p>
        <PrimaryButton type="button" onClick={() => (setLoadError(null), void load())}>
          {t.tryAgain}
        </PrimaryButton>
      </main>
    );
  }
  if (!library) {
    return (
      <main className="message-screen" aria-busy="true">
        <p>{t.loading}</p>
      </main>
    );
  }

  const create = (event: FormEvent) => {
    event.preventDefault();
    const clean = title.trim();
    if (clean.length < 2) return;
    run(async () => onOpenDeck((await api.createDeck(clean)).id));
  };
  // An empty deck has nothing to study yet: it opens for adding words.
  const open = (deck: LibraryDeck, mine: boolean) =>
    mine && deck.word_count === 0 ? onOpenDeck(deck.id) : onOpenPage(deck.id);

  return (
    <div className={styles.screen}>
      <header className={styles.topbar}>
        {/* "0 weeks" would only greet newcomers with a zero. */}
        <span className={styles.streak}>
          {streak !== null && streak > 0 && (
            <>
              <FlameIcon aria-hidden="true" />
              {t.weeksInARow(streak)}
            </>
          )}
        </span>
      </header>
      <main className={styles.main}>
        <div className={styles.column}>
          <div className={styles.head}>
            <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
              {t.myDecks}
            </h1>
          </div>

          {naming ? (
            <form className={styles.newDeck} onSubmit={create}>
              <label className={styles.field}>
                <span>{t.newDeckSName}</span>
                <input
                  ref={nameField}
                  value={title}
                  maxLength={80}
                  placeholder={t.forExampleTravel}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <div className={styles.newDeckActions}>
                <PrimaryButton type="submit" disabled={busy || title.trim().length < 2}>
                  {t.create}
                </PrimaryButton>
                <button type="button" className={styles.linkButton} onClick={() => setNaming(false)}>
                  {t.cancel}
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className={styles.createTile} onClick={() => setNaming(true)}>
              <span className={styles.createMark} aria-hidden="true">
                <PlusIcon />
              </span>
              <span className={styles.createText}>
                <strong>{t.createADeck}</strong>
                <span>{t.wordsByHandOrCardsWith}</span>
              </span>
            </button>
          )}

          {error && (
            <p className={styles.problem} role="alert">
              {error}
            </p>
          )}

          <section aria-labelledby="mine-title" className={styles.section}>
            {/* No visible heading: the decks under «Создать колоду» are the learner's own. It stays
                for screen readers, which name the section by it. */}
            <h2 id="mine-title" className="visually-hidden">
              {t.createdByMe}
            </h2>
            {library.mine.length === 0 ? (
              <p className={styles.empty}>{t.noDecksOfYourOwnYet}</p>
            ) : (
              <ul className={styles.list}>
                {library.mine.map((deck) => (
                  <li key={deck.id} className={styles.row}>
                    <button type="button" className={styles.study} disabled={busy} onClick={() => open(deck, true)}>
                      <DeckText deck={deck} source={sharedLine(deck)} />
                      <ForwardIcon className={styles.chevron} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={styles.edit}
                      onClick={() => onOpenDeck(deck.id)}
                      aria-label={t.editDeckNamed(deck.title)}
                    >
                      <PencilIcon aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {library.from_groups.length > 0 && (
            <section aria-labelledby="groups-title" className={styles.section}>
              <h2 id="groups-title" className={styles.sectionTitle}>
                {t.fromMyGroups}
              </h2>
              <ul className={styles.list}>
                {library.from_groups.map((deck) => (
                  <li key={deck.id} className={styles.row}>
                    <button type="button" className={styles.study} disabled={busy} onClick={() => open(deck, false)}>
                      <DeckText
                        deck={deck}
                        source={
                          deck.author ? t.from(deck.author, deck.group_name ?? '') : t.group(deck.group_name ?? '')
                        }
                      />
                      <ForwardIcon className={styles.chevron} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* The course, level by level: offered, one tap away (ADR 0021). */}
          {/* Only for those studying in Russian, the language it is written in (ADR 0055). */}
          {onOpenCourse && (
            <section className={styles.course} aria-labelledby="course-title">
              <h2 id="course-title" className={styles.courseTitle}>
                {t.englishByLevels}
              </h2>
              <p className={styles.courseText}>{t.aReadyMadeCourseTheMost}</p>
              <button type="button" className={styles.outlineButton} onClick={onOpenCourse}>
                {t.openTheCourse}
                <ForwardIcon aria-hidden="true" />
              </button>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

const sharedLine = (deck: LibraryDeck) =>
  deck.groups.length ? t.inGroupNamed(deck.groups.map((group) => group.name).join(', ')) : null;

/** Name and size; today's counts are on the deck's own page, not here (ADR 0037). */
function DeckText({ deck, source }: { deck: LibraryDeck; source: string | null }) {
  return (
    <span className={styles.text}>
      <strong>{deck.title}</strong>
      <span className={styles.meta}>
        {deck.word_count === 0 ? (
          t.emptyAddSomeWords
        ) : (
          <>
            {wordsLabel(deck.word_count)} · <span className={styles.nowrap}>{t.metCount(deck.introduced_count)}</span>
          </>
        )}
        {source && ` · ${source}`}
      </span>
      {deck.due_on && (
        // A teacher's deadline (ADR 0030): how long is left and what is still to meet.
        <span className={styles.deadline}>
          {deadlineLeft(deck.due_on, localToday(), deck.word_count - deck.introduced_count)}
        </span>
      )}
    </span>
  );
}
