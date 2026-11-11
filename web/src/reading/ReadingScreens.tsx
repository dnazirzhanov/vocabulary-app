import literataUrl from '@fontsource-variable/literata/files/literata-latin-wght-normal.woff2?url';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { describeError } from '../lib/api.ts';
import { playAudio } from '../lib/audio.ts';
import { wordsLabel } from '../lib/pace.ts';
import { partOfSpeech } from '../lib/partOfSpeech.ts';
import type { Session } from '../lib/types.ts';
import type { LocalCard } from '../local/db.ts';
import { localDb } from '../local/session.ts';
import { useLocalVersion } from '../local/sync.ts';
import { study } from '../study/device.ts';
import {
  BackIcon,
  CardsIcon,
  CheckIcon,
  CloseIcon,
  ForwardIcon,
  MarkerIcon,
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
import { addWord, basketCards, cardFor, findDeck, removeWord } from './basket.ts';
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

/** Articles a topic shows when opened, before «Показать ещё». */
const FIRST_ARTICLES = 5;
let lastOpen: Topic | null = null;
const rememberTopic = (topic: Topic | null) => {
  lastOpen = topic;
};

// --- the library -------------------------------------------------------------------------------

/**
 * «Чтение»: topics first, each a row with its number of articles; opening one shows its articles
 * (five, then «Показать ещё»). The level switch narrows everything.
 */
export function Library({ account, onOpen }: { account: string; onOpen: (id: string) => void }) {
  const [cards, setCards] = useState<ArticleCard[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [level, setLevel] = useState<Level | null>(null);
  // The topic last opened, kept while the app runs: back from an article, it is still open.
  const [open, setOpen] = useState<Topic | null>(lastOpen);
  const [showAll, setShowAll] = useState(false);
  const progress = useMemo(() => readProgress(account), [account]);
  const load = useCallback(() => {
    loadIndex().then(setCards, () => setFailed(true));
  }, []);
  useEffect(load, [load]);
  const retry = () => {
    setFailed(false);
    load();
  };
  const toggle = (topic: Topic) => {
    const next = open === topic ? null : topic;
    rememberTopic(next);
    setOpen(next);
    setShowAll(false);
  };

  const levels = LEVELS.filter((one) => cards?.some((card) => card.level === one));
  const shown = cards?.filter((card) => level === null || card.level === level) ?? [];
  const topics = TOPICS.filter((topic) => shown.some((card) => card.topic === topic));
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
          {topics.length === 0 && <p className={styles.state}>{t.noArticlesAtLevel}</p>}
          <ul className={styles.topics}>
            {topics.map((topic) => {
              const inTopic = shown.filter((card) => card.topic === topic);
              const expanded = open === topic;
              const visible = expanded && !showAll ? inTopic.slice(0, FIRST_ARTICLES) : inTopic;
              return (
                <li key={topic} className={styles.topicItem}>
                  <button
                    type="button"
                    className={styles.topicRow}
                    aria-expanded={expanded}
                    aria-controls={`topic-${topic}`}
                    onClick={() => toggle(topic)}
                  >
                    <span className={styles.topicName}>{TOPIC_NAME[topic]()}</span>
                    <span className={styles.topicCount}>{inTopic.length}</span>
                    <ForwardIcon className={styles.topicChevron} aria-hidden="true" />
                  </button>
                  {expanded && (
                    <section id={`topic-${topic}`} aria-label={TOPIC_NAME[topic]()}>
                      <ul className={styles.cards}>
                        {visible.map((card) => (
                          <li key={card.id}>
                            <ArticleRow card={card} read={progress[card.id]} onOpen={() => onOpen(card.id)} />
                          </li>
                        ))}
                      </ul>
                      {!showAll && inTopic.length > FIRST_ARTICLES && (
                        <button type="button" className={styles.more} onClick={() => setShowAll(true)}>
                          {t.showMore} · {inTopic.length - FIRST_ARTICLES}
                        </button>
                      )}
                    </section>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </main>
  );
}

function ArticleRow({
  card,
  read,
  onOpen,
}: {
  card: ArticleCard;
  read: ReturnType<typeof readProgress>[string] | undefined;
  onOpen: () => void;
}) {
  const share = read && !read.doneAt && read.of > 0 ? (read.at + 1) / read.of : 0;
  return (
    <button type="button" className={styles.card} onClick={onOpen}>
      <span className={styles.cardTitle} lang="en">
        {card.title}
      </span>
      <span className={styles.cardSubtitle} lang="en">
        {card.subtitle}
      </span>
      <span className={styles.cardMeta}>
        {card.level} · {t.min(card.minutes)}
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
    const meaning = article.glossary[form];
    const paragraph = word.closest<HTMLElement>('[data-i]');
    if (!meaning || !paragraph) return;
    const point = { p: Number(paragraph.dataset.i), o: Number(word.dataset.o) };
    active.current?.classList.remove(styles.active);
    word.classList.add(styles.active);
    active.current = word;
    setProblem(null);
    setTapped({ form, meaning, point, sentence: sentenceAt(article.body[point.p].replace(HEADING, ''), point.o) });
  };

  const save = async (word: Tapped) => {
    const db = localDb();
    if (!db || !article) return;
    try {
      const id = await addWord(db, account, article, word.meaning, word.sentence);
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
        <button
          type="button"
          className={styles.barButton}
          onClick={() => setPanel('words')}
          aria-label={`${t.articleWords}: ${cards.length}`}
          aria-haspopup="dialog"
        >
          <CardsIcon aria-hidden="true" />
          {cards.length > 0 && <span className={styles.count}>{cards.length}</span>}
        </button>
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
            {article.level} · {TOPIC_NAME[article.topic]()} · {t.min(article.minutes)}
          </p>
          <h1 className={styles.title}>{article.title}</h1>
          <p className={styles.subtitle}>{article.subtitle}</p>
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
          <footer className={styles.end} lang="ru">
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
          <p className={styles.translation}>{tapped.meaning.ru}</p>
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

      {panel === 'words' && (
        <Dialog open onClose={() => setPanel(null)} title={t.articleWords}>
          {cards.length === 0 ? (
            <p className={styles.empty}>{t.tapAWordToSave}</p>
          ) : (
            <ul className={styles.list}>
              {cards.map((card) => (
                <li key={card.id}>
                  <div className={styles.listText}>
                    <strong lang="en">{card.headword}</strong> — {card.translation}
                    <span lang="en">{card.example}</span>
                  </div>
                  <button
                    type="button"
                    className={styles.sheetIcon}
                    onClick={() => void unsave(card)}
                    aria-label={`${t.removeWord}: ${card.headword}`}
                  >
                    <TrashIcon aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {problem && <p role="alert">{problem}</p>}
          {studyLabel && (
            <PrimaryButton type="button" onClick={() => void learn()}>
              {studyLabel}
            </PrimaryButton>
          )}
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
