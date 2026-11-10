import { localDb, withSnapshot } from '../local/session.ts';
import { setOffline } from '../local/online.ts';
import { readSnapshot } from '../local/db.ts';
import { mergeMine, type KeptDeck } from '../local/library.ts';
import { createDeck, deckCards, myDecks, syncState, takeNotices } from '../local/myDecks.ts';
import { syncNow, useLocalVersion } from '../local/sync.ts';
import type { Me } from '../lib/types.ts';
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
  // My decks as this device has them: made, renamed or deleted here, maybe not sent yet (ADR 0061).
  const [kept, setKept] = useState<{ decks: KeptDeck[]; pulled: boolean } | null>(null);
  // Changes lost because their deck or card was deleted on another device: said once.
  const [lost, setLost] = useState(0);
  // Answers the server didn't count (a phone's clock set back, or a month old): said once.
  const [refused, setRefused] = useState(0);
  const localVersion = useLocalVersion();
  useEffect(() => {
    const db = localDb();
    if (!db) return;
    void (async () => {
      const decks = await myDecks(db);
      const counted = await Promise.all(
        decks.map(async (deck) => ({ deck, cards: (await deckCards(db, deck.id)).length })),
      );
      setKept({ decks: counted, pulled: (await syncState(db)).pulledAt !== null });
      const newly = await takeNotices(db);
      if (newly.lost > 0) setLost((before) => before + newly.lost);
      if (newly.refused > 0) setRefused((before) => before + newly.refused);
    })().catch(() => null);
  }, [localVersion]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nameField = useRef<HTMLInputElement>(null);

  // Without a connection, the list as this device last saw it (offline store).
  const load = useCallback(
    () =>
      withSnapshot('library', () => api.library()).then(
        ({ value, offline }) => {
          setLibrary(value);
          if (offline) setOffline(true);
        },
        (caught: unknown) => setLoadError(describeError(caught)),
      ),
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
    run(async () => {
      const db = localDb();
      if (!db) return onOpenDeck((await api.createDeck(clean)).id);
      // Made on this device at once, sent when there is a connection (ADR 0061).
      const me = (await readSnapshot<Me>(db, 'me'))?.value;
      const deck = await createDeck(db, clean, me?.language ?? 'ru');
      // Online, it is on the server before the editor opens, so AI can add to it at once;
      // offline this returns straight away and the deck waits on this device.
      await syncNow();
      onOpenDeck(deck.id);
    });
  };
  const mine = mergeMine(library.mine, kept?.decks ?? null, kept?.pulled ?? false);
  const onlyHere = new Set(
    mine.filter((deck) => !library.mine.some((item) => item.id === deck.id)).map((deck) => deck.id),
  );
  // An empty deck has nothing to study yet: it opens for adding words. So does one of mine not
  // yet on the server: its page is worked out from the study pack, which doesn't have it yet.
  const open = (deck: LibraryDeck, isMine: boolean) =>
    isMine && (deck.word_count === 0 || onlyHere.has(deck.id)) ? onOpenDeck(deck.id) : onOpenPage(deck.id);

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
          {lost > 0 && (
            <p className={styles.lost} role="status">
              {t.lostChanges(lost)}
            </p>
          )}
          {refused > 0 && (
            <p className={styles.lost} role="status">
              {t.answersNotCounted(refused)}
            </p>
          )}
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
              <span className={styles.createText}>{t.createADeck}</span>
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
            {mine.length === 0 ? (
              <p className={styles.empty}>{t.noDecksOfYourOwnYet}</p>
            ) : (
              <ul className={styles.list}>
                {mine.map((deck) => (
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
            <section className={styles.section}>
              <ul className={styles.list}>
                <li className={styles.row}>
                  <button type="button" className={styles.study} onClick={onOpenCourse}>
                    <span className={styles.text}>
                      <strong>{t.englishByLevels}</strong>
                    </span>
                    <ForwardIcon className={styles.chevron} aria-hidden="true" />
                  </button>
                </li>
              </ul>
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
