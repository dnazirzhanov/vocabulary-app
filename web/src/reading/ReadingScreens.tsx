import literataUrl from '@fontsource-variable/literata/files/literata-latin-wght-normal.woff2?url';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { api, describeError } from '../lib/api.ts';
import { playAudio } from '../lib/audio.ts';
import { wordsLabel } from '../lib/pace.ts';
import { partOfSpeech } from '../lib/partOfSpeech.ts';
import type { OwnReadings, Session } from '../lib/types.ts';
import type { LocalCard } from '../local/db.ts';
import { localDb } from '../local/session.ts';
import { syncSoon, useLocalVersion } from '../local/sync.ts';
import { study } from '../study/device.ts';
import {
  BackIcon,
  CardsIcon,
  CheckIcon,
  CloseIcon,
  ForwardIcon,
  MarkerIcon,
  PencilIcon,
  PlusIcon,
  SpeakerIcon,
  TrashIcon,
} from '../ui/icons.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { t } from '../i18n/index.ts';
import {
  HEADING,
  LEVELS,
  MAX_SIZE,
  MIN_SIZE,
  TOPICS,
  loadArticle,
  loadIndex,
  loadOwn,
  ownArticle,
  readAppearance,
  readProgress,
  saveAppearance,
  saveProgress,
  type Appearance,
  type Article,
  type ArticleCard,
  type Level,
  type Meaning,
  type Theme,
  type Topic,
} from './articles.ts';
import { loadAnswerCounts } from './answers.ts';
import { addWord, basketCards, cardFor, findDeck, readingRef, removeWord } from './basket.ts';
import { Questions } from './Questions.tsx';
import { ordered, readNotes, saveNotes } from './notes.ts';
import { contains, coverage, quoteOf, runs, sentenceAt, snap, type Highlight, type Point } from './text.ts';
import styles from './Reading.module.css';

// The reading face, loaded with this screen only: one Latin file, about 50 KB.
if (typeof FontFace !== 'undefined' && typeof document !== 'undefined') {
  const face = new FontFace('Literata Reader', `url(${literataUrl}) format('woff2')`, {
    weight: '200 900',
    display: 'swap',
  });
  document.fonts.add(face);
  void face.load().catch(() => undefined);
}

const TOPIC_NAME: Record<Topic, () => string> = {
  science: () => t.topicScience,
  technology: () => t.topicTechnology,
  nature: () => t.topicNature,
  society: () => t.topicSociety,
  psychology: () => t.topicPsychology,
  history: () => t.topicHistory,
  culture: () => t.topicCulture,
};

/** Articles a section shows when opened, before «Показать ещё». */
const FIRST_ARTICLES = 5;
// The section last opened, kept while the app runs: back from an article, it is still open.
let lastOpen: string | null = null;
const rememberSection = (key: string | null) => {
  lastOpen = key;
};

/** A row in the library: one of its articles, or a text of mine. */
interface Row {
  id: string;
  title: string;
  subtitle?: string;
  level: string | null;
  minutes: number;
  drafting?: boolean;
  /** Questions it asks; how many I answered shows once I start. */
  questions?: number;
}

/** A section: one of my categories (or my texts outside any), or one of the library's topics. */
interface Section {
  key: string;
  name: string;
  rows: Row[];
  /** Mine: offers «Добавить текст» into it; a category of mine can also be renamed or deleted. */
  mine?: { categoryId: string | null };
}

// --- the library -------------------------------------------------------------------------------

/**
 * «Чтение»: my categories, then the library's topics, each a row with its number of texts; opening
 * one shows them (five, then «Показать ещё»). The level switch narrows everything. «Свой текст»
 * at the end adds one of my own.
 */
export function Library({
  account,
  onOpen,
  onAddText,
}: {
  account: string;
  onOpen: (id: string) => void;
  onAddText: (categoryId: string | null) => void;
}) {
  const [cards, setCards] = useState<ArticleCard[] | null>(null);
  const [own, setOwn] = useState<OwnReadings | null>(null);
  const [answered, setAnswered] = useState<Record<string, number>>({});
  const [failed, setFailed] = useState(false);
  const [level, setLevel] = useState<Level | null>(null);
  const [open, setOpen] = useState<string | null>(lastOpen);
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const progress = useMemo(() => readProgress(account), [account]);
  const load = useCallback(() => {
    loadIndex().then(setCards, () => setFailed(true));
    // Mine are a bonus to the library: without them (offline, never loaded), it still shows.
    loadOwn().then(setOwn, () => setOwn({ categories: [], readings: [] }));
    void loadAnswerCounts().then(setAnswered);
  }, []);
  useEffect(load, [load]);
  const retry = () => {
    setFailed(false);
    load();
  };
  const toggle = (key: string) => {
    const next = open === key ? null : key;
    rememberSection(next);
    setOpen(next);
    setShowAll(false);
  };

  const fits = (rowLevel: string | null) => level === null || rowLevel === level;
  const levels = LEVELS.filter(
    (one) => cards?.some((card) => card.level === one) || own?.readings.some((reading) => reading.level === one),
  );
  const ownRow = (reading: OwnReadings['readings'][number]): Row => ({
    id: reading.id,
    title: reading.title,
    level: reading.level,
    minutes: reading.minutes,
    drafting: reading.status === 'drafting',
    questions: reading.questions_count,
  });
  const mine = own?.readings.filter((reading) => fits(reading.level)) ?? [];
  const sections: Section[] = [
    // My categories, even an empty one: it is where the next text goes.
    ...(own?.categories ?? []).map((category) => ({
      key: `category:${category.id}`,
      name: category.name,
      rows: mine.filter((reading) => reading.category_id === category.id).map(ownRow),
      mine: { categoryId: category.id },
    })),
    ...(mine.some((reading) => reading.category_id === null)
      ? [
          {
            key: 'mine',
            name: t.myTexts,
            rows: mine.filter((reading) => reading.category_id === null).map(ownRow),
            mine: { categoryId: null },
          },
        ]
      : []),
    ...TOPICS.map((topic) => ({
      key: topic,
      name: TOPIC_NAME[topic](),
      rows: (cards ?? []).filter((card) => card.topic === topic && fits(card.level)),
    })).filter((section) => section.rows.length > 0),
  ];
  const renameCategory = (id: string, name: string) =>
    api.renameReadingCategory(id, name).then(() => (setEditing(null), load()));
  const deleteCategory = (id: string) => api.deleteReadingCategory(id).then(() => (setEditing(null), load()));

  return (
    <main className={styles.library}>
      <h1 className={styles.libraryTitle}>{t.reading}</h1>
      {failed && (
        <div className={styles.state} role="alert">
          <p>{t.articleMissing}</p>
          <button type="button" className={styles.retry} onClick={retry}>
            {t.tryAgain}
          </button>
        </div>
      )}
      {!cards && !failed && <p className={styles.state}>{t.loading}</p>}
      {cards && (
        <>
          <div className={styles.levels} role="group" aria-label={t.level}>
            {[null, ...levels].map((one) => (
              <button key={one ?? 'all'} type="button" aria-pressed={level === one} onClick={() => setLevel(one)}>
                {one ?? t.all}
              </button>
            ))}
          </div>
          {sections.length === 0 && <p className={styles.state}>{t.noArticlesAtLevel}</p>}
          <ul className={styles.topics}>
            {sections.map((section) => {
              const expanded = open === section.key;
              const visible = expanded && !showAll ? section.rows.slice(0, FIRST_ARTICLES) : section.rows;
              const id = `section-${section.key.replace(/[^a-z0-9-]/gi, '-')}`;
              return (
                <li key={section.key} className={styles.topicItem}>
                  <button
                    type="button"
                    className={styles.topicRow}
                    aria-expanded={expanded}
                    aria-controls={id}
                    onClick={() => toggle(section.key)}
                  >
                    <span className={styles.topicName}>{section.name}</span>
                    <span className={styles.topicCount}>{section.rows.length}</span>
                    <ForwardIcon className={styles.topicChevron} aria-hidden="true" />
                  </button>
                  {expanded && (
                    <section id={id} aria-label={section.name}>
                      {section.rows.length === 0 && <p className={styles.emptySection}>{t.emptyCategory}</p>}
                      <ul className={styles.cards}>
                        {visible.map((row) => (
                          <li key={row.id}>
                            <ArticleRow
                              row={row}
                              read={progress[row.id]}
                              answered={answered[readingRef(row.id)] ?? 0}
                              onOpen={() => onOpen(row.id)}
                            />
                          </li>
                        ))}
                      </ul>
                      {!showAll && section.rows.length > FIRST_ARTICLES && (
                        <button type="button" className={styles.more} onClick={() => setShowAll(true)}>
                          {t.showMore} · {section.rows.length - FIRST_ARTICLES}
                        </button>
                      )}
                      {section.mine && (
                        <div className={styles.sectionActions}>
                          <button type="button" onClick={() => onAddText(section.mine!.categoryId)}>
                            <PlusIcon aria-hidden="true" /> {t.addTextHere}
                          </button>
                          {section.mine.categoryId && (
                            <button
                              type="button"
                              onClick={() => setEditing({ id: section.mine!.categoryId!, name: section.name })}
                            >
                              <PencilIcon aria-hidden="true" /> {t.editCategory}
                            </button>
                          )}
                        </div>
                      )}
                    </section>
                  )}
                </li>
              );
            })}
            <li className={styles.topicItem}>
              <button type="button" className={styles.topicRow} onClick={() => onAddText(null)}>
                <span className={styles.topicName}>
                  <PlusIcon aria-hidden="true" className={styles.plus} /> {t.ownText}
                </span>
              </button>
            </li>
          </ul>
        </>
      )}
      {editing && (
        <CategoryDialog
          name={editing.name}
          onClose={() => setEditing(null)}
          onRename={(name) => renameCategory(editing.id, name)}
          onDelete={() => deleteCategory(editing.id)}
        />
      )}
    </main>
  );
}

/** Renaming one of my categories, or deleting it (its texts stay, outside any category). */
function CategoryDialog({
  name,
  onClose,
  onRename,
  onDelete,
}: {
  name: string;
  onClose: () => void;
  onRename: (name: string) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}) {
  const [value, setValue] = useState(name);
  const [problem, setProblem] = useState<string | null>(null);
  const attempt = (action: () => Promise<unknown>) => () =>
    void action().catch((error: unknown) => setProblem(describeError(error)));
  return (
    <Dialog open onClose={onClose} title={t.editCategory}>
      <form
        className={styles.categoryForm}
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) attempt(() => onRename(value.trim()))();
        }}
      >
        <label>
          <span>{t.categoryName}</span>
          <input value={value} maxLength={40} onChange={(event) => setValue(event.target.value)} />
        </label>
        {problem && <p role="alert">{problem}</p>}
        <PrimaryButton type="submit" disabled={!value.trim()}>
          {t.save}
        </PrimaryButton>
      </form>
      <button type="button" className={styles.deleteText} onClick={attempt(onDelete)}>
        {t.deleteCategory}
      </button>
      <p className={styles.emptySection}>{t.textsStay}</p>
    </Dialog>
  );
}

function ArticleRow({
  row,
  read,
  answered,
  onOpen,
}: {
  row: Row;
  read: ReturnType<typeof readProgress>[string] | undefined;
  answered: number;
  onOpen: () => void;
}) {
  const share = read && !read.doneAt && read.of > 0 ? (read.at + 1) / read.of : 0;
  return (
    <button type="button" className={styles.card} onClick={onOpen}>
      <span className={styles.cardTitle} lang="en">
        {row.title}
      </span>
      {row.subtitle && (
        <span className={styles.cardSubtitle} lang="en">
          {row.subtitle}
        </span>
      )}
      <span className={styles.cardMeta}>
        {[row.level, t.min(row.minutes)].filter(Boolean).join(' · ')}
        {row.drafting && <span> · {t.meaningsComing}</span>}
        {answered > 0 && row.questions ? <span> · {t.answersOf(answered, row.questions)}</span> : null}
        {read?.doneAt && (
          <span className={styles.finished}>
            {' '}
            · <CheckIcon aria-hidden="true" /> {t.readingFinished}
          </span>
        )}
      </span>
      {share > 0 && (
        <span className={styles.cardBar} aria-hidden="true">
          <span style={{ width: `${Math.round(share * 100)}%` }} />
        </span>
      )}
    </button>
  );
}

// --- the article text ----------------------------------------------------------------------------

/**
 * One paragraph: each word a span (tapped through the article's one listener), highlights as
 * <mark>. Drawn again only when its own highlights change.
 */
const Paragraph = memo(
  function Paragraph({
    index,
    text,
    glossary,
    highlights,
  }: {
    index: number;
    text: string;
    glossary: Record<string, Meaning>;
    highlights: Highlight[];
    marks: string;
  }) {
    const heading = text.startsWith(HEADING);
    const content = heading ? text.slice(HEADING.length) : text;
    // Offsets are into the paragraph as stored, heading marker included.
    const shift = heading ? HEADING.length : 0;
    const inner = runs(content, index, shifted(highlights, index, shift)).map((run, r) => {
      const words = run.pieces.map((piece) =>
        piece.key ? (
          <span
            key={piece.start}
            data-f={piece.key}
            data-o={piece.start + shift}
            data-l={glossary[piece.key]?.l.toLowerCase()}
          >
            {piece.text}
          </span>
        ) : (
          piece.text
        ),
      );
      return run.highlight ? (
        <mark key={r} data-h={run.highlight} className={styles.mark}>
          {words}
        </mark>
      ) : (
        words
      );
    });
    return heading ? (
      <h2 className={styles.heading} data-i={index}>
        {inner}
      </h2>
    ) : (
      <p className={styles.paragraph} data-i={index}>
        {inner}
      </p>
    );
  },
  (a, b) => a.text === b.text && a.marks === b.marks && a.glossary === b.glossary,
);

/** Highlights moved into a heading's own text (its "## " marker is not drawn). */
function shifted(highlights: readonly Highlight[], p: number, shift: number): Highlight[] {
  if (!shift) return [...highlights];
  const move = (point: Point) => (point.p === p ? { p, o: Math.max(0, point.o - shift) } : point);
  return highlights.map((one) => ({ ...one, from: move(one.from), to: move(one.to) }));
}

/** Paragraph index and offset of a place in the DOM, by the text before it in its paragraph. */
function pointOf(node: Node, offset: number): Point | null {
  const element = node instanceof Element ? node : node.parentElement;
  const paragraph = element?.closest<HTMLElement>('[data-i]');
  if (!paragraph) return null;
  const range = document.createRange();
  range.setStart(paragraph, 0);
  range.setEnd(node, offset);
  const heading = paragraph.tagName === 'H2' ? HEADING.length : 0;
  return { p: Number(paragraph.dataset.i), o: range.toString().length + heading };
}

// --- the reader --------------------------------------------------------------------------------

const THEMES: { theme: Theme; label: () => string }[] = [
  { theme: 'paper', label: () => t.themePaper },
  { theme: 'sepia', label: () => t.themeSepia },
  { theme: 'night', label: () => t.themeNight },
];

interface Tapped {
  form: string;
  meaning: Meaning;
  /** No meaning yet: a text of mine whose meanings are still being written, or one left out. */
  missing?: boolean;
  point: Point;
  sentence: string;
}

/**
 * A full-screen page that reads like a book. Tap a word: its meaning in a sheet below, and
 * «Добавить в слова». Select text: highlight it, or add a note.
 */
export function Reader({
  account,
  articleId,
  onBack,
  onStudy,
}: {
  account: string;
  articleId: string;
  onBack: () => void;
  onStudy: (session: Session, deckId: string) => void;
}) {
  const [article, setArticle] = useState<Article | null>(null);
  const [failed, setFailed] = useState(false);
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);
  const [panel, setPanel] = useState<'appearance' | 'words' | 'notes' | null>(null);
  const [tapped, setTapped] = useState<Tapped | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>(() => readNotes(account, articleId));
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, setPending] = useState<{ from: Point; to: Point } | null>(null);
  const [deckId, setDeckId] = useState<string | null>(null);
  const [cards, setCards] = useState<LocalCard[]>([]);
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const localVersion = useLocalVersion();
  const scroller = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLElement>(null);
  const bar = useRef<HTMLElement>(null);
  const fill = useRef<HTMLSpanElement>(null);
  const active = useRef<HTMLElement | null>(null);

  const load = useCallback(() => {
    loadArticle(articleId).then(setArticle, () => setFailed(true));
  }, [articleId]);
  useEffect(load, [load]);
  const retry = () => {
    setFailed(false);
    load();
  };
  useEffect(() => {
    void study.learningHeadwords().then(setKnown);
  }, []);

  // A text of mine whose meanings are being written: asked again until they are (and kept here).
  const drafting = article?.own?.status === 'drafting' ? article.id : null;
  useEffect(() => {
    if (!drafting) return;
    const timer = setInterval(() => {
      loadArticle(drafting).then(
        (next) => {
          if (next.own?.status === 'drafting') return;
          setArticle(next);
          // An open sheet that had no meaning gets it.
          setTapped((before) =>
            before?.missing && next.glossary[before.form]
              ? { ...before, meaning: next.glossary[before.form], missing: false }
              : before,
          );
        },
        () => undefined,
      );
    }, 2500);
    return () => clearInterval(timer);
  }, [drafting]);
  const redraft = () => {
    if (!article) return;
    api.redraftReading(article.id).then(
      (reading) => setArticle(ownArticle(reading)),
      (error: unknown) => setProblem(describeError(error)),
    );
  };
  const [deleting, setDeleting] = useState(false);
  const deleteText = () => {
    if (!article) return;
    api.deleteReading(article.id).then(onBack, (error: unknown) => setProblem(describeError(error)));
  };

  // The basket: this article's deck, if one was made; refreshed when anything kept here changes.
  useEffect(() => {
    const db = localDb();
    if (!db || !article) return;
    let live = true;
    void findDeck(db, account, article.id, article.title).then(async (id) => {
      const found = await basketCards(db, id);
      if (!live) return;
      setDeckId(id);
      setCards(found);
    });
    return () => {
      live = false;
    };
  }, [account, article, localVersion]);

  const change = (next: Appearance) => {
    setAppearance(next);
    saveAppearance(next);
  };
  const keep = (next: Highlight[]) => {
    setHighlights(next);
    saveNotes(account, articleId, next);
  };

  // Back where I stopped: the furthest paragraph seen, unless the article was finished.
  useLayoutEffect(() => {
    if (!article) return;
    const kept = readProgress(account)[article.id];
    if (!kept || kept.doneAt || kept.at < 1) return;
    scroller.current?.querySelector(`[data-i="${kept.at}"]`)?.scrollIntoView({ block: 'start' });
  }, [article, account]);

  // The top bar hides while reading down and comes back on the way up; the hairline shows how
  // far through the page I am. Written straight to the DOM, once per frame: no re-render.
  useEffect(() => {
    const element = scroller.current;
    if (!element || !article) return;
    let last = element.scrollTop;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const top = element.scrollTop;
        const room = element.scrollHeight - element.clientHeight;
        if (fill.current) fill.current.style.transform = `scaleX(${room > 0 ? Math.min(1, top / room) : 1})`;
        if (bar.current) bar.current.dataset.hidden = top > last && top > 80 ? 'true' : 'false';
        last = top;
      });
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      element.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [article]);

  // How far I've read, by the paragraphs that came into view; written at most once a second.
  useEffect(() => {
    const element = scroller.current;
    if (!element || !article) return;
    const total = article.body.length;
    let furthest = readProgress(account)[article.id]?.at ?? 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const save = () => {
      timer = null;
      saveProgress(account, article.id, (now) => ({ ...now, at: Math.max(now?.at ?? 0, furthest), of: total }));
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          furthest = Math.max(furthest, Number((entry.target as HTMLElement).dataset.i));
        }
        timer ??= setTimeout(save, 1000);
      },
      { root: element, threshold: 0.6 },
    );
    element.querySelectorAll('[data-i]').forEach((node) => observer.observe(node));
    return () => {
      observer.disconnect();
      if (timer) {
        clearTimeout(timer);
        save();
      }
    };
  }, [article, account]);

  const closeWord = useCallback(() => {
    active.current?.classList.remove(styles.active);
    active.current = null;
    setTapped(null);
  }, []);

  // Esc closes the word's sheet, as ✕ does; a dialog above it takes its own Esc.
  useEffect(() => {
    if (!tapped || panel || editing) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && closeWord();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tapped, panel, editing, closeWord]);

  // A selection in the text offers «Выделить» and «Заметка», snapped to whole words. It is the
  // newer intent, so it replaces an open word sheet.
  useEffect(() => {
    if (!article) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      timer = null;
      const selection = document.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount || !page.current) return setPending(null);
      const range = selection.getRangeAt(0);
      if (!page.current.contains(range.commonAncestorContainer)) return setPending(null);
      const from = pointOf(range.startContainer, range.startOffset);
      const to = pointOf(range.endContainer, range.endOffset);
      const whole = from && to ? snap(article.body, from, to) : null;
      if (whole) closeWord();
      setPending(whole);
    };
    const onChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(check, 150);
    };
    document.addEventListener('selectionchange', onChange);
    return () => {
      document.removeEventListener('selectionchange', onChange);
      if (timer) clearTimeout(timer);
    };
  }, [article, closeWord]);

  // Every word, through one listener: a tap (not a scroll or a selection) opens its meaning.
  const onArticleClick = (event: React.MouseEvent) => {
    if (!article) return;
    const selection = document.getSelection();
    if (selection && !selection.isCollapsed) return;
    const word = (event.target as HTMLElement).closest<HTMLElement>('[data-f]');
    if (!word) return closeWord();
    const form = word.dataset.f!;
    const found = article.glossary[form];
    const meaning = found ?? { l: form, p: null, t: '', d: null };
    const paragraph = word.closest<HTMLElement>('[data-i]');
    if (!paragraph) return;
    const point = { p: Number(paragraph.dataset.i), o: Number(word.dataset.o) };
    active.current?.classList.remove(styles.active);
    word.classList.add(styles.active);
    active.current = word;
    setProblem(null);
    setTapped({
      form,
      meaning,
      missing: !found,
      point,
      sentence: sentenceAt(article.body[point.p].replace(HEADING, ''), point.o),
    });
  };

  const save = async (word: Tapped) => {
    const db = localDb();
    if (!db || !article) return;
    try {
      const id = await addWord(db, account, article, word.meaning, word.sentence);
      // To the server soon, as the deck editor does; offline, the outbox keeps it.
      syncSoon();
      setDeckId(id);
      setCards(await basketCards(db, id));
    } catch (error) {
      setProblem(describeError(error));
    }
  };
  const unsave = async (card: LocalCard) => {
    const db = localDb();
    if (!db) return;
    await removeWord(db, card.id);
    syncSoon();
    setCards(await basketCards(db, deckId));
  };
  const learn = async () => {
    if (!deckId) return;
    try {
      onStudy(await study.startStudySession(deckId), deckId);
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const makeHighlight = (withNote: boolean) => {
    if (!article || !pending) return;
    const highlight: Highlight = {
      id: crypto.randomUUID(),
      ...pending,
      quote: quoteOf(article.body, pending.from, pending.to).replace(HEADING, ''),
      note: '',
      createdAt: new Date().toISOString(),
    };
    keep([...highlights, highlight]);
    document.getSelection()?.removeAllRanges();
    setPending(null);
    if (withNote) setEditing(highlight.id);
  };

  // Words in this article's deck are marked with one style rule: the text is never re-rendered.
  const savedStyle = cards.length
    ? `${cards.map((card) => `.${styles.page} [data-l="${CSS.escape(card.headword.toLowerCase())}"]`).join(',')}{background:var(--saved);border-radius:3px}`
    : '';
  const marksFor = (p: number, length: number) =>
    highlights
      .map((one) => coverage(one, p, length)?.join('-') + one.id)
      .filter((key) => !key.startsWith('undefined'))
      .join('|');
  const tappedCard = tapped ? cardFor(cards, tapped.meaning.l) : null;
  const tappedHighlight = tapped ? highlights.find((one) => contains(one, tapped.point)) : undefined;
  const editingHighlight = highlights.find((one) => one.id === editing);
  const studyLabel = cards.length ? t.studyWords(wordsLabel(cards.length)) : null;

  return (
    <div
      ref={scroller}
      className={styles.reader}
      data-theme={appearance.theme}
      data-sheet={tapped || pending ? 'open' : undefined}
      style={{ '--reader-size': `${appearance.size}px` } as CSSProperties}
    >
      {savedStyle && <style>{savedStyle}</style>}
      <header ref={bar} className={styles.bar} data-hidden="false">
        <button type="button" className={styles.barButton} onClick={onBack} aria-label={t.back}>
          <BackIcon aria-hidden="true" />
        </button>
        <span className={styles.barSpace} />
        <button
          type="button"
          className={styles.barButton}
          onClick={() => setPanel('notes')}
          aria-label={`${t.notes}: ${highlights.length}`}
          aria-haspopup="dialog"
        >
          <MarkerIcon aria-hidden="true" />
          {highlights.length > 0 && <span className={styles.count}>{highlights.length}</span>}
        </button>
        {/* Words kept from this text: one tap into their lesson. Before any, how to keep one. */}
        {cards.length > 0 ? (
          <button type="button" className={styles.studyPill} onClick={() => void learn()}>
            {t.studyWords(cards.length)}
          </button>
        ) : (
          <button
            type="button"
            className={styles.barButton}
            onClick={() => setPanel('words')}
            aria-label={`${t.articleWords}: 0`}
            aria-haspopup="dialog"
          >
            <CardsIcon aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className={styles.barButton}
          onClick={() => setPanel('appearance')}
          aria-label={t.readingAppearance}
          aria-haspopup="dialog"
        >
          <span className={styles.aa} aria-hidden="true">
            Aa
          </span>
        </button>
        <span className={styles.track} role="presentation">
          <span ref={fill} className={styles.fill} />
        </span>
      </header>

      {problem && !tapped && (
        <p className={styles.barProblem} role="alert">
          {problem}
        </p>
      )}
      {failed && (
        <div className={styles.readerState} role="alert">
          <p>{t.articleMissing}</p>
          <button type="button" className={styles.retry} onClick={retry}>
            {t.tryAgain}
          </button>
        </div>
      )}
      {!article && !failed && <p className={styles.readerState}>{t.loading}</p>}

      {article && (
        <article ref={page} className={styles.page} lang="en">
          <p className={styles.kicker} lang="ru">
            {[article.level, article.topic ? TOPIC_NAME[article.topic]() : t.myText, t.min(article.minutes)]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <h1 className={styles.title}>{article.title}</h1>
          {article.subtitle && <p className={styles.subtitle}>{article.subtitle}</p>}
          {article.own?.status === 'drafting' && (
            <p className={styles.ownNote} role="status">
              {t.meaningsComing}
            </p>
          )}
          {article.own?.status === 'failed' && (
            <p className={styles.ownNote} role="alert">
              {t.meaningsFailed}{' '}
              <button type="button" className={styles.retry} onClick={redraft}>
                {t.tryAgain}
              </button>
            </p>
          )}
          {/* Words are tapped through this one listener; keyboard users read the sheet's list. */}
          <div className={styles.body} onClick={onArticleClick}>
            {article.body.map((text, index) => (
              <Paragraph
                key={index}
                index={index}
                text={text}
                glossary={article.glossary}
                highlights={highlights}
                marks={marksFor(index, text.length)}
              />
            ))}
          </div>
          <Questions account={account} readingRef={readingRef(article.id)} questions={article.questions} />
          <footer className={styles.end} lang="ru">
            {article.source && (
              <p className={styles.source}>
                {t.readingSource}:{' '}
                {article.source.url ? (
                  <a href={article.source.url} target="_blank" rel="noreferrer" lang="en">
                    {article.source.name}
                  </a>
                ) : (
                  <span lang="en">{article.source.name}</span>
                )}{' '}
                · {article.source.license}
                {article.source.note && <span lang="en"> · {article.source.note}</span>}
              </p>
            )}
            {studyLabel && (
              <PrimaryButton type="button" className={styles.done} onClick={() => void learn()}>
                {studyLabel}
              </PrimaryButton>
            )}
            <button
              type="button"
              className={studyLabel ? styles.secondary : styles.primaryDone}
              onClick={() => {
                saveProgress(account, article.id, () => ({
                  at: article.body.length - 1,
                  of: article.body.length,
                  doneAt: new Date().toISOString(),
                }));
                onBack();
              }}
            >
              {t.readingDone}
            </button>
          </footer>
        </article>
      )}

      {/* A selection: highlight it, or highlight it with a note. */}
      {pending && !tapped && (
        <div className={styles.selectionBar} lang="ru">
          <button type="button" onClick={() => makeHighlight(false)}>
            <MarkerIcon aria-hidden="true" /> {t.highlight}
          </button>
          <button type="button" onClick={() => makeHighlight(true)}>
            {t.addNote}
          </button>
        </div>
      )}

      {/* The word's meaning: a sheet that leaves the text above it readable. */}
      {tapped && (
        <section className={styles.wordSheet} aria-label={tapped.meaning.l} lang="ru">
          <div className={styles.wordHead}>
            <p className={styles.wordTitle} lang="en">
              {tapped.form !== tapped.meaning.l.toLowerCase() && <span className={styles.form}>{tapped.form} → </span>}
              <strong>{tapped.meaning.l}</strong>
              {tapped.meaning.p && tapped.meaning.p !== 'other' && (
                <span className={styles.pos}>{partOfSpeech(tapped.meaning.p).short}</span>
              )}
            </p>
            <button
              type="button"
              className={styles.sheetIcon}
              onClick={() => void playAudio('words', tapped.meaning.l, tapped.meaning.l)}
              aria-label={t.listen(tapped.meaning.l)}
            >
              <SpeakerIcon aria-hidden="true" />
            </button>
            <button type="button" className={styles.sheetIcon} onClick={closeWord} aria-label={t.close}>
              <CloseIcon aria-hidden="true" />
            </button>
          </div>
          {tapped.missing ? (
            <p className={styles.definition}>{article?.own?.status === 'drafting' ? t.meaningsComing : t.noMeaning}</p>
          ) : (
            <p className={styles.translation}>{tapped.meaning.t}</p>
          )}
          {tapped.meaning.d && (
            <p className={styles.definition} lang="en">
              {tapped.meaning.d}
            </p>
          )}
          <p className={styles.context} lang="en">
            {tapped.sentence}
          </p>
          {known.has(tapped.meaning.l.toLowerCase()) && !tappedCard && (
            <p className={styles.known}>
              <CheckIcon aria-hidden="true" /> {t.alreadyLearning}
            </p>
          )}
          {tappedHighlight && (
            <button type="button" className={styles.noteLink} onClick={() => setEditing(tappedHighlight.id)}>
              <MarkerIcon aria-hidden="true" /> {tappedHighlight.note ? tappedHighlight.note : t.highlighted}
            </button>
          )}
          {problem && (
            <p className={styles.problem} role="alert">
              {problem}
            </p>
          )}
          {tapped.meaning.p !== null &&
            (tappedCard ? (
              <div className={styles.saved}>
                <span>
                  <CheckIcon aria-hidden="true" /> {t.inBasket}
                </span>
                <button type="button" onClick={() => void unsave(tappedCard)}>
                  {t.removeWord}
                </button>
              </div>
            ) : (
              <PrimaryButton type="button" onClick={() => void save(tapped)}>
                {t.addToWords}
              </PrimaryButton>
            ))}
        </section>
      )}

      {/* Before any word is kept: how to keep one. After, the bar's «Учить · N» takes its place. */}
      {panel === 'words' && (
        <Dialog open onClose={() => setPanel(null)} title={t.articleWords}>
          <p className={styles.empty}>{t.tapAWordToSave}</p>
        </Dialog>
      )}

      {panel === 'notes' && (
        <Dialog open onClose={() => setPanel(null)} title={t.notes}>
          {highlights.length === 0 ? (
            <p className={styles.empty}>{t.noHighlights}</p>
          ) : (
            <ul className={styles.list}>
              {ordered(highlights).map((one) => (
                <li key={one.id}>
                  <button
                    type="button"
                    className={styles.quote}
                    onClick={() => {
                      setPanel(null);
                      requestAnimationFrame(() =>
                        scroller.current?.querySelector(`[data-h="${one.id}"]`)?.scrollIntoView({ block: 'center' }),
                      );
                    }}
                  >
                    <q lang="en">{one.quote}</q>
                    {one.note && <span>{one.note}</span>}
                  </button>
                  <button
                    type="button"
                    className={styles.sheetIcon}
                    onClick={() => setEditing(one.id)}
                    aria-label={`${t.yourNote}: ${one.quote}`}
                  >
                    <MarkerIcon aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Dialog>
      )}

      {editingHighlight && (
        <NoteEditor
          highlight={editingHighlight}
          onClose={() => setEditing(null)}
          onSave={(note) => {
            keep(highlights.map((one) => (one.id === editingHighlight.id ? { ...one, note } : one)));
            setEditing(null);
          }}
          onDelete={() => {
            keep(highlights.filter((one) => one.id !== editingHighlight.id));
            setEditing(null);
          }}
        />
      )}

      {panel === 'appearance' && (
        <Dialog open onClose={() => setPanel(null)} title={t.readingAppearance}>
          <div className={styles.setting}>
            <span className={styles.settingLabel}>{t.textSize}</span>
            <div className={styles.sizer}>
              <button
                type="button"
                aria-label={t.fewer}
                disabled={appearance.size <= MIN_SIZE}
                onClick={() => change({ ...appearance, size: appearance.size - 1 })}
              >
                <span className={styles.smallA}>A</span>
              </button>
              <output aria-live="polite">{appearance.size}</output>
              <button
                type="button"
                aria-label={t.more}
                disabled={appearance.size >= MAX_SIZE}
                onClick={() => change({ ...appearance, size: appearance.size + 1 })}
              >
                <span className={styles.bigA}>A</span>
              </button>
            </div>
          </div>
          <div className={styles.setting}>
            <span className={styles.settingLabel}>{t.readingTheme}</span>
            <div className={styles.themes} role="radiogroup" aria-label={t.readingTheme}>
              {THEMES.map(({ theme, label }) => (
                <button
                  key={theme}
                  type="button"
                  role="radio"
                  aria-checked={appearance.theme === theme}
                  data-swatch={theme}
                  onClick={() => change({ ...appearance, theme })}
                >
                  {label()}
                </button>
              ))}
            </div>
          </div>
          {/* A text of my own can go; the library's cannot. */}
          {article?.own && (
            <button type="button" className={styles.deleteText} onClick={() => (setPanel(null), setDeleting(true))}>
              {t.deleteText}
            </button>
          )}
        </Dialog>
      )}

      {deleting && article && (
        <Dialog open onClose={() => setDeleting(false)} title={t.deleteTheText(article.title)}>
          <p>{t.theTextWillBeDeleted}</p>
          {problem && <p role="alert">{problem}</p>}
          <div className={styles.confirm}>
            <button type="button" className={styles.danger} onClick={deleteText}>
              {t.deleteText}
            </button>
            <button type="button" className={styles.secondary} onClick={() => setDeleting(false)}>
              {t.cancel}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function NoteEditor({
  highlight,
  onClose,
  onSave,
  onDelete,
}: {
  highlight: Highlight;
  onClose: () => void;
  onSave: (note: string) => void;
  onDelete: () => void;
}) {
  const [note, setNote] = useState(highlight.note);
  return (
    <Dialog open onClose={onClose} title={t.yourNote}>
      <q className={styles.editorQuote} lang="en">
        {highlight.quote}
      </q>
      <textarea
        className={styles.noteField}
        aria-label={t.yourNote}
        value={note}
        maxLength={1000}
        rows={4}
        onChange={(event) => setNote(event.target.value)}
        data-autofocus
      />
      <PrimaryButton type="button" onClick={() => onSave(note.trim())}>
        {t.save}
      </PrimaryButton>
      <button type="button" className={styles.deleteNote} onClick={onDelete}>
        <TrashIcon aria-hidden="true" /> {t.deleteHighlight}
      </button>
    </Dialog>
  );
}
