import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { DeckPath, Stone } from '../lib/path.ts';
import { hopsBetween } from '../lib/path.ts';
import { wordsLabel } from '../lib/pace.ts';
import { RepeatIcon } from '../ui/icons.tsx';
import { Frog } from './Frog.tsx';
import { StoneMark } from './StoneMark.tsx';
import styles from './PathView.module.css';

const STATUS: Record<string, string> = {
  not_started: 'впереди',
  new: 'новое',
  learning: 'учу',
  well_learned: 'помню хорошо',
};
const HOP_MS = 600;
const BANNER_MS = 2600;
const FROG = 56;

// Which stone the frog was last shown on, kept for this visit only: coming back from a lesson
// that finished a stone, the frog hops instead of teleporting. A reload simply shows the position.
let lastShownStone: number | null = null;

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function caption(stone: Stone): string {
  if (stone.state === 'current') return `${stone.met} из ${stone.words.length}`;
  if (stone.state === 'firm') return 'помните хорошо';
  if (stone.state === 'done') return 'пройден';
  return wordsLabel(stone.words.length);
}

function stoneLabel(stone: Stone, total: number): string {
  const where = stone.state === 'current' ? ', вы здесь' : '';
  const due = stone.due > 0 ? `, ${stone.due} к повторению` : '';
  return `Камень ${stone.number} из ${total}, этап ${stone.level}: ${caption(stone)}${where}${due}. Показать слова`;
}

interface PathViewProps {
  path: DeckPath;
  deckWords: number;
  /** What comes after this deck's finish: the next level, or more of the course later. */
  finishNote: string | null;
  /** Scroll the current stone into view on arrival (off where the path sits below other content). */
  follow?: boolean;
}

/** The deck as stones across water. The frog stands on the current stone and hops forward. */
export function PathView({ path, deckWords, finishNote, follow = true }: PathViewProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const frogRef = useRef<HTMLDivElement>(null);
  const stoneRefs = useRef(new Map<number, HTMLButtonElement>());
  const [open, setOpen] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const current = path.current?.number ?? null;
  // Read once per visit to the path; written back in the effect below (render stays pure).
  const [arrival] = useState(() => {
    const from = lastShownStone;
    const levelOf = (number: number | null) => (number === null ? 0 : (path.stones[number - 1]?.level ?? 0));
    const hops = current === null ? [] : hopsBetween(from, current);
    return { from, hops, finishedLevel: hops.length > 0 && levelOf(current) > levelOf(from) ? levelOf(from) : null };
  });
  const [bannerShown, setBannerShown] = useState(true);
  const banner = bannerShown ? arrival.finishedLevel : null;

  /** Where the frog stands on a stone, relative to the track (transforms included). */
  const spotOf = useCallback((number: number) => {
    const track = trackRef.current?.getBoundingClientRect();
    const stone = stoneRefs.current.get(number)?.getBoundingClientRect();
    if (!track || !stone) return null;
    return {
      x: stone.left - track.left + stone.width / 2 - FROG / 2,
      y: stone.top - track.top + stone.height * 0.42 - FROG,
    };
  }, []);

  const place = useCallback(
    (number: number) => {
      const spot = spotOf(number);
      if (spot && frogRef.current) frogRef.current.style.transform = `translate(${spot.x}px, ${spot.y}px)`;
    },
    [spotOf],
  );

  // Arrive: hop over every stone finished since the frog was last seen, else just stand there.
  useLayoutEffect(() => {
    if (current === null) return;
    lastShownStone = current;
    const { from, hops, finishedLevel } = arrival;
    const frog = frogRef.current;
    const last = hops[hops.length - 1];
    if (!frog || from === null || last !== current) {
      place(current);
      return;
    }
    // Announced after this frame: a live region only speaks changes made after it is on the page.
    const frame = requestAnimationFrame(() =>
      setAnnouncement(`Вы перешли на камень ${current}.${finishedLevel ? ` Этап ${finishedLevel} пройден!` : ''}`),
    );
    if (reducedMotion()) {
      place(current);
      return () => cancelAnimationFrame(frame);
    }
    let cancelled = false;
    place(from);
    void (async () => {
      let at = from;
      for (const next of hops) {
        const a = spotOf(at);
        const b = spotOf(next);
        if (!a || !b || cancelled) break;
        const lift = Math.min(90, 40 + Math.abs(b.y - a.y) * 0.25);
        const mid = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - lift };
        await frog.animate(
          [
            { transform: `translate(${a.x}px, ${a.y}px) scale(1.05, 0.9)` },
            { transform: `translate(${mid.x}px, ${mid.y}px) scale(0.95, 1.08)`, offset: 0.5 },
            { transform: `translate(${b.x}px, ${b.y}px) scale(1.08, 0.88)`, offset: 0.9 },
            { transform: `translate(${b.x}px, ${b.y}px) scale(1, 1)` },
          ],
          { duration: HOP_MS, easing: 'cubic-bezier(0.3, 0, 0.3, 1)' },
        ).finished;
        at = next;
        place(at);
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [current, arrival, place, spotOf]);

  // Keep the frog on its stone when the layout changes size (rotation, window resize).
  useEffect(() => {
    const track = trackRef.current;
    if (!track || current === null) return;
    const observer = new ResizeObserver(() => place(current));
    observer.observe(track);
    return () => observer.disconnect();
  }, [current, place]);

  useEffect(() => {
    if (arrival.finishedLevel === null) return;
    const timer = window.setTimeout(() => setBannerShown(false), BANNER_MS);
    return () => window.clearTimeout(timer);
  }, [arrival.finishedLevel]);

  // Bring the current stone into view on arrival without jumping past the header above the path.
  useEffect(() => {
    if (follow && current !== null) stoneRefs.current.get(current)?.scrollIntoView({ block: 'nearest' });
  }, [current, follow]);

  return (
    <section className={styles.scene} aria-labelledby="path-title">
      <h2 id="path-title" className="visually-hidden">
        Путь по колоде
      </h2>
      <div ref={trackRef} className={styles.track}>
        <ol className={styles.levels}>
          {path.levels.map((level) => {
            const state = level.stones.every((stone) => stone.state === 'done' || stone.state === 'firm')
              ? 'done'
              : level.stones.some((stone) => stone.state === 'current')
                ? 'current'
                : 'locked';
            return (
              <li key={level.number} className={styles.level}>
                <p className={styles.levelMark} data-state={state}>
                  <span>Этап {level.number}</span>
                  <small>{state === 'done' ? 'пройден' : state === 'current' ? 'сейчас' : 'впереди'}</small>
                </p>
                <ol className={styles.stones}>
                  {level.stones.map((stone) => {
                    const shift = Math.sin((stone.number - 1) * 1.15 + 0.3);
                    return (
                      <li
                        key={stone.number}
                        className={styles.stoneItem}
                        style={{ '--shift': shift.toFixed(3) } as CSSProperties}
                        data-state={stone.state}
                      >
                        <button
                          type="button"
                          ref={(element) => {
                            if (element) stoneRefs.current.set(stone.number, element);
                            else stoneRefs.current.delete(stone.number);
                          }}
                          className={styles.stone}
                          aria-expanded={open === stone.number}
                          aria-label={stoneLabel(stone, path.stones.length)}
                          onClick={() => setOpen(open === stone.number ? null : stone.number)}
                        >
                          <StoneMark state={stone.state} number={stone.number} />
                          {stone.due > 0 && (
                            <span className={styles.due} aria-hidden="true">
                              <RepeatIcon /> {stone.due}
                            </span>
                          )}
                        </button>
                        <p className={styles.caption} aria-hidden="true">
                          {stone.state === 'current' && (
                            <span className={styles.pips}>
                              {stone.words.map((row, pip) => (
                                <i key={row.word.id} data-on={pip < stone.met || undefined} />
                              ))}
                            </span>
                          )}
                          {caption(stone)}
                        </p>
                        {open === stone.number && (
                          <div
                            className={styles.popover}
                            onKeyDown={(event) => event.key === 'Escape' && setOpen(null)}
                          >
                            <p className={styles.popoverTitle}>Камень {stone.number}</p>
                            <ul>
                              {stone.words.map((row) => (
                                <li key={row.word.id}>
                                  <span lang="en">{row.word.headword}</span>
                                  <span className={styles.popoverStatus}>{STATUS[row.status]}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </li>
            );
          })}
        </ol>
        <div className={styles.finish}>
          <svg viewBox="0 0 160 70" aria-hidden="true">
            <ellipse
              cx="80"
              cy="50"
              rx="76"
              ry="18"
              fill="var(--illo-sand)"
              stroke="var(--illo-line)"
              strokeWidth="3"
            />
            <path d="M80 50V12" stroke="var(--illo-line)" strokeWidth="3" strokeLinecap="round" />
            <path
              d="M80 13l26 8-26 8z"
              fill="var(--illo-accent)"
              stroke="var(--illo-line)"
              strokeWidth="3"
              strokeLinejoin="round"
            />
          </svg>
          <p className={styles.finishTitle}>Финиш колоды · {wordsLabel(deckWords)}</p>
          {finishNote && <p className={styles.finishNote}>{finishNote}</p>}
        </div>
        {current !== null && (
          <div ref={frogRef} className={styles.frog} aria-hidden="true">
            <Frog />
          </div>
        )}
      </div>
      {banner !== null && (
        <div className={styles.banner} aria-hidden="true">
          <span className={styles.splash} />
          Этап {banner} пройден!
        </div>
      )}
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </section>
  );
}
