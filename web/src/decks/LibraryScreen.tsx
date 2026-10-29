import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, describeError } from '../lib/api.ts';
import { wordsLabel } from '../lib/pace.ts';
import type { Library, LibraryDeck, Session } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { BackIcon, ForwardIcon, PencilIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './LibraryScreen.module.css';

interface LibraryScreenProps {
  onBack: () => void;
  /** A study session for one deck, started from here. */
  onSession: (session: Session, deckId: string) => void;
  onOpenDeck: (deckId: string) => void;
}

/**
 * «Мои колоды» (ADR 0019): the decks I wrote and the decks my groups were given. Tapping a deck
 * studies it, within today's pace; my own decks can be edited, and a new one starts here.
 */
export function LibraryScreen({ onBack, onSession, onOpenDeck }: LibraryScreenProps) {
  const [library, setLibrary] = useState<Library | null>(null);
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
          Повторить
        </PrimaryButton>
      </main>
    );
  }
  if (!library) {
    return (
      <main className="message-screen" aria-busy="true">
        <p>Загружаем…</p>
      </main>
    );
  }

  const create = (event: FormEvent) => {
    event.preventDefault();
    const clean = title.trim();
    if (clean.length < 2) return;
    run(async () => onOpenDeck((await api.createDeck(clean, null)).id));
  };
  // An empty deck has nothing to study yet: it opens for adding words.
  const open = (deck: LibraryDeck, mine: boolean) =>
    run(async () => {
      if (mine && deck.word_count === 0) return onOpenDeck(deck.id);
      onSession(await api.startStudySession(deck.id), deck.id);
    });

  return (
    <div className={styles.screen}>
      <header className={styles.topbar}>
        <button type="button" className={styles.back} onClick={onBack}>
          <BackIcon aria-hidden="true" /> Сегодня
        </button>
      </header>
      <main className={styles.main}>
        <div className={styles.column}>
          <div className={styles.head}>
            <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
              Мои колоды
            </h1>
            {!naming && (
              <button type="button" className={styles.outlineButton} onClick={() => setNaming(true)}>
                <PencilIcon aria-hidden="true" /> Новая колода
              </button>
            )}
          </div>
          <p className={styles.lead}>
            Свои колоды и колоды из ваших групп. Колода учится, когда вы её открываете — в пределах вашего темпа.
          </p>

          {naming && (
            <form className={styles.newDeck} onSubmit={create}>
              <label className={styles.field}>
                <span>Название новой колоды</span>
                <input
                  ref={nameField}
                  value={title}
                  maxLength={80}
                  placeholder="Например, Путешествия"
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <div className={styles.newDeckActions}>
                <PrimaryButton type="submit" disabled={busy || title.trim().length < 2}>
                  Создать
                </PrimaryButton>
                <button type="button" className={styles.linkButton} onClick={() => setNaming(false)}>
                  Отмена
                </button>
              </div>
            </form>
          )}

          {error && (
            <p className={styles.problem} role="alert">
              {error}
            </p>
          )}

          <section aria-labelledby="mine-title" className={styles.section}>
            <h2 id="mine-title" className={styles.sectionTitle}>
              Созданные мной
            </h2>
            {library.mine.length === 0 ? (
              <p className={styles.empty}>
                Своих колод пока нет. Создайте колоду и добавьте слова — вручную или пусть ИИ составит карточки по слову
                или по тексту.
              </p>
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
                      aria-label={`Изменить «${deck.title}»`}
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
                Из моих групп
              </h2>
              <ul className={styles.list}>
                {library.from_groups.map((deck) => (
                  <li key={deck.id} className={styles.row}>
                    <button type="button" className={styles.study} disabled={busy} onClick={() => open(deck, false)}>
                      <DeckText
                        deck={deck}
                        source={deck.author ? `от ${deck.author} · ${deck.group_name}` : `группа ${deck.group_name}`}
                      />
                      <ForwardIcon className={styles.chevron} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

const sharedLine = (deck: LibraryDeck) =>
  deck.groups.length ? `в группе ${deck.groups.map((group) => group.name).join(', ')}` : null;

/** Name, size, today's counts in words (not columns: rows need room for the edit button). */
function DeckText({ deck, source }: { deck: LibraryDeck; source: string | null }) {
  const today = [
    deck.new_today && `${deck.new_today} нов.`,
    deck.learning_count && `${deck.learning_count} изуч.`,
    deck.review_count && `${deck.review_count} повт.`,
  ].filter(Boolean);
  return (
    <span className={styles.text}>
      <strong>{deck.title}</strong>
      <span className={styles.meta}>
        {deck.word_count === 0 ? (
          'пусто — добавьте слова'
        ) : (
          <>
            {wordsLabel(deck.word_count)} · <span className={styles.nowrap}>встречено {deck.introduced_count}</span>
          </>
        )}
        {source && ` · ${source}`}
      </span>
      {today.length > 0 && <span className={styles.today}>Сегодня: {today.join(' · ')}</span>}
    </span>
  );
}
