import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { t } from '../i18n/index.ts';
import { CRITERIA, type CriterionName, type Submission } from './api.ts';
import { clock } from './stopwatch.ts';
import { criterionLabel, scoreLabel } from './scoreText.ts';
import { collectFixes, segments, type Fix } from './marks.ts';
import styles from './Writing.module.css';

interface Props {
  submission: Submission;
  onBack: () => void;
  /** Back to the writing screen with this answer in the box; absent if the question is gone. */
  onWriteAgain?: () => void;
  onAnother: () => void;
}

/**
 * The feedback: the answer with its fixes marked and numbered on one side, the five categories as
 * tabs on the other. A category with fixes shows only the fixes; one without shows its comment.
 */
export function ResultScreen({ submission, onBack, onWriteAgain, onAnother }: Props) {
  const ev = submission.evaluation;
  const enough = ev !== null && ev.enough_evidence && ev.criteria !== null && ev.overall !== null;
  const fixes = useMemo(() => (ev ? collectFixes(submission.answer, ev) : []), [ev, submission.answer]);

  return (
    <main className={`${styles.screen} ${enough ? styles.resultWide : ''}`}>
      <button type="button" className={styles.back} onClick={onBack}>
        ‹ {t.back}
      </button>
      <h1 className={styles.context}>{submission.question?.title ?? t.writing}</h1>

      {ev && enough && ev.overall !== null && (
        <section aria-labelledby="w-overall">
          <h2 id="w-overall" className={styles.visuallyHidden}>
            {t.writingScoreHeading}
          </h2>
          <p className={styles.scoreLine}>
            <strong>{scoreLabel(ev.overall)}</strong>
            <span>
              {t.writingScoreOutOf(ev.overall)}
              {ev.cefr_level ? ` · ${t.writingLevel(ev.cefr_level)}` : ''}
              {submission.time_spent_seconds !== null
                ? ` · ${t.writingTimeSpent(clock(submission.time_spent_seconds))}`
                : ''}
            </span>
          </p>
        </section>
      )}

      {ev && enough ? (
        <Review answer={submission.answer} fixes={fixes} criteria={ev.criteria!} />
      ) : (
        <section aria-labelledby="w-overall" className={styles.verdict}>
          {ev && (
            <h2 id="w-overall" className={styles.verdictHeading}>
              {t.writingTooLittleHeading}
            </h2>
          )}
          {ev && <p className={styles.text}>{ev.summary}</p>}
          <p className={`${styles.text} ${styles.essay}`}>{submission.answer}</p>
        </section>
      )}

      {ev && enough && ev.improvements.length > 0 && (
        <section className={styles.next} aria-labelledby="w-next">
          <h2 id="w-next" className={styles.nextTitle}>
            {t.writingNextStep}
          </h2>
          <ol className={styles.steps}>
            {ev.improvements.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </section>
      )}

      <div className={styles.actions}>
        {onWriteAgain && (
          <button type="button" className={styles.secondary} onClick={onWriteAgain}>
            {t.writingWriteAgain}
          </button>
        )}
        <button type="button" className={styles.submit} onClick={onAnother}>
          {t.writingTryAnother}
        </button>
      </div>
    </main>
  );
}

interface ReviewProps {
  answer: string;
  fixes: Fix[];
  criteria: Record<CriterionName, { score: number; comment: string }>;
}

function Review({ answer, fixes, criteria }: ReviewProps) {
  // Open on the category of the first fix in the answer; with no fixes, on the first category.
  const [tab, setTab] = useState<CriterionName>(() => fixes[0]?.home ?? CRITERIA[0]);
  const [marked, setMarked] = useState(true);
  const [focus, setFocus] = useState<number | null>(null);
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});
  const items = useRef<Record<number, HTMLLIElement | null>>({});

  // A tap on a mark in the answer opens its category and brings its fix into view.
  useEffect(() => {
    if (focus === null) return;
    items.current[focus]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const id = window.setTimeout(() => setFocus(null), 1600);
    return () => window.clearTimeout(id);
  }, [focus, tab]);

  // On a phone the tabs scroll sideways: keep the open one in sight, moving only the tab row.
  useEffect(() => {
    const el = tabs.current[tab];
    const row = el?.parentElement;
    if (!el || !row || row.scrollWidth <= row.clientWidth) return;
    const left = el.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft || left + el.offsetWidth > row.scrollLeft + row.clientWidth) {
      row.scrollTo({ left: Math.max(0, left - 16), behavior: 'smooth' });
    }
  }, [tab]);

  const openFix = (fix: Fix) => {
    setTab(fix.home);
    setFocus(fix.n);
  };

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = CRITERIA[(CRITERIA.indexOf(tab) + step + CRITERIA.length) % CRITERIA.length];
    setTab(next);
    tabs.current[next]?.focus();
  };

  const shown = fixes.filter((f) => f.home === tab);
  const criterion = criteria[tab];

  return (
    <div className={styles.review}>
      <section className={styles.answerPane} aria-labelledby="w-answer">
        <header className={styles.paneHead}>
          <h2 id="w-answer" className={styles.paneTitle}>
            {t.writingYourAnswer}
          </h2>
          <div className={styles.toggle} role="group" aria-labelledby="w-answer">
            <button type="button" aria-pressed={!marked} onClick={() => setMarked(false)}>
              {t.writingViewOriginal}
            </button>
            <button type="button" aria-pressed={marked} onClick={() => setMarked(true)}>
              {t.writingViewFixes}
            </button>
          </div>
        </header>
        <p className={styles.essay} lang="en">
          {marked
            ? segments(answer, fixes).map((s, i) =>
                s.fix ? (
                  // A <mark>, not a <button>: a button can't break across lines inside running text.
                  <mark
                    key={i}
                    role="button"
                    tabIndex={0}
                    className={s.fix.kind === 'tip' ? styles.markTip : styles.mark}
                    onClick={() => openFix(s.fix!)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      openFix(s.fix!);
                    }}
                  >
                    {s.text}
                    <sup>{s.fix.n}</sup>
                  </mark>
                ) : (
                  <span key={i}>{s.text}</span>
                ),
              )
            : answer}
        </p>
      </section>

      <section className={styles.fixesPane}>
        <div className={styles.tabs} role="tablist">
          {CRITERIA.map((name) => (
            <button
              key={name}
              ref={(el) => {
                tabs.current[name] = el;
              }}
              type="button"
              role="tab"
              id={`w-tab-${name}`}
              aria-selected={tab === name}
              aria-controls="w-panel"
              tabIndex={tab === name ? 0 : -1}
              className={styles.tab}
              onClick={() => setTab(name)}
              onKeyDown={onTabKey}
            >
              {criterionLabel(name)}
            </button>
          ))}
        </div>

        <div id="w-panel" role="tabpanel" aria-labelledby={`w-tab-${tab}`} className={styles.panel}>
          <p className={styles.panelScore}>
            <span className={styles.pips} aria-hidden="true">
              {[1, 2, 3, 4, 5].map((n) => (
                <i key={n} className={n <= criterion.score ? styles.pipOn : styles.pip} />
              ))}
            </span>
            {scoreLabel(criterion.score)} · {t.writingScoreOutOf(criterion.score)}
          </p>
          {shown.length === 0 ? (
            <p className={styles.comment}>{criterion.comment}</p>
          ) : (
            <ol className={styles.fixList}>
              {shown.map((f) => (
                <li
                  key={f.n}
                  ref={(el) => {
                    items.current[f.n] = el;
                  }}
                  className={focus === f.n ? `${styles.fixItem} ${styles.fixFocus}` : styles.fixItem}
                >
                  <span className={f.kind === 'tip' ? styles.numTip : styles.num} aria-hidden="true">
                    {f.n}
                  </span>
                  <div className={styles.fixBody}>
                    <p className={styles.fixLine} lang="en">
                      {f.before}
                      <del>{f.original}</del>
                      <ins>{f.replacement}</ins>
                      {f.after}
                    </p>
                    {f.why && <p className={styles.fixWhy}>{f.why}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
