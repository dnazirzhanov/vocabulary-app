import literataUrl from '@fontsource-variable/literata/files/literata-latin-wght-normal.woff2?url';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BackIcon, CheckIcon } from '../ui/icons.tsx';
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
  type Theme,
  type Topic,
} from './articles.ts';
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

// --- the library -------------------------------------------------------------------------------

/** «Чтение»: articles by topic, filtered by level; each with its length and how far I've read. */
export function Library({ account, onOpen }: { account: string; onOpen: (id: string) => void }) {
  const [cards, setCards] = useState<ArticleCard[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [level, setLevel] = useState<Level | null>(null);
  const progress = useMemo(() => readProgress(account), [account]);
  const load = useCallback(() => {
    loadIndex().then(setCards, () => setFailed(true));
  }, []);
  useEffect(load, [load]);
  const retry = () => {
    setFailed(false);
    load();
  };

  const levels = LEVELS.filter((one) => cards?.some((card) => card.level === one));
  const shown = cards?.filter((card) => level === null || card.level === level) ?? [];
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
          {shown.length === 0 && <p className={styles.state}>{t.noArticlesAtLevel}</p>}
          {TOPICS.map((topic) => {
            const inTopic = shown.filter((card) => card.topic === topic);
            if (inTopic.length === 0) return null;
            return (
              <section key={topic} className={styles.topic} aria-label={TOPIC_NAME[topic]()}>
                <h2 className={styles.topicTitle} aria-hidden="true">
                  {TOPIC_NAME[topic]()}
                </h2>
                <ul className={styles.cards}>
                  {inTopic.map((card) => {
                    const read = progress[card.id];
                    const share = read && !read.doneAt && read.of > 0 ? (read.at + 1) / read.of : 0;
                    return (
                      <li key={card.id}>
                        <button type="button" className={styles.card} onClick={() => onOpen(card.id)}>
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
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </main>
  );
}

// --- the reader --------------------------------------------------------------------------------

/** The article itself, drawn once: nothing that changes while reading re-renders it. */
const ArticleBody = memo(function ArticleBody({ body }: { body: string[] }) {
  return (
    <>
      {body.map((paragraph, index) =>
        paragraph.startsWith(HEADING) ? (
          <h2 key={index} className={styles.heading} data-i={index}>
            {paragraph.slice(HEADING.length)}
          </h2>
        ) : (
          <p key={index} className={styles.paragraph} data-i={index}>
            {paragraph}
          </p>
        ),
      )}
    </>
  );
});

const THEMES: { theme: Theme; label: () => string }[] = [
  { theme: 'paper', label: () => t.themePaper },
  { theme: 'sepia', label: () => t.themeSepia },
  { theme: 'night', label: () => t.themeNight },
];

/** A full-screen page that reads like a book: the text first, the controls out of the way. */
export function Reader({ account, articleId, onBack }: { account: string; articleId: string; onBack: () => void }) {
  const [article, setArticle] = useState<Article | null>(null);
  const [failed, setFailed] = useState(false);
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLElement>(null);
  const fill = useRef<HTMLSpanElement>(null);

  const load = useCallback(() => {
    loadArticle(articleId).then(setArticle, () => setFailed(true));
  }, [articleId]);
  useEffect(load, [load]);
  const retry = () => {
    setFailed(false);
    load();
  };

  const change = (next: Appearance) => {
    setAppearance(next);
    saveAppearance(next);
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

  const finish = () => {
    if (article) {
      saveProgress(account, article.id, () => ({
        at: article.body.length - 1,
        of: article.body.length,
        doneAt: new Date().toISOString(),
      }));
    }
    onBack();
  };

  return (
    <div
      ref={scroller}
      className={styles.reader}
      data-theme={appearance.theme}
      style={{ '--reader-size': `${appearance.size}px` } as React.CSSProperties}
    >
      <header ref={bar} className={styles.bar} data-hidden="false">
        <button type="button" className={styles.barButton} onClick={onBack} aria-label={t.back}>
          <BackIcon aria-hidden="true" />
        </button>
        <span className={styles.barSpace} />
        <button
          type="button"
          className={styles.barButton}
          onClick={() => setSettingsOpen(true)}
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
        <article className={styles.page} lang="en">
          <p className={styles.kicker} lang="ru">
            {article.level} · {TOPIC_NAME[article.topic]()} · {t.min(article.minutes)}
          </p>
          <h1 className={styles.title}>{article.title}</h1>
          <p className={styles.subtitle}>{article.subtitle}</p>
          <div className={styles.body}>
            <ArticleBody body={article.body} />
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
            <PrimaryButton type="button" className={styles.done} onClick={finish}>
              {t.readingDone}
            </PrimaryButton>
          </footer>
        </article>
      )}

      {settingsOpen && (
        <Dialog open onClose={() => setSettingsOpen(false)} title={t.readingAppearance}>
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
