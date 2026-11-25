import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { t } from '../i18n/index.ts';
import {
  CRITERIA,
  IELTS_CRITERIA,
  IELTS_WORDS,
  isIelts,
  type CriterionName,
  type GeneralEvaluation,
  type IeltsCriterionName,
  type IeltsEvaluation,
  type Submission,
} from './api.ts';
import { clock } from '../lib/stopwatch.ts';
import { bandText, criterionLabel, ieltsLabel, ieltsShort, scoreLabel, taskTypeLabel } from './scoreText.ts';
import { collectFixes, collectIeltsFixes, segments, type Fix } from './marks.ts';
import { TappableText } from '../ui/TappableText.tsx';
import styles from './Writing.module.css';
import { BackButton } from '../ui/BackButton.tsx';

interface Props {
  submission: Submission;
  onBack: () => void;
  /** Back to the writing screen with this answer in the box; absent if the question is gone. */
  onWriteAgain?: () => void;
  onAnother: () => void;
}

/**
 * The feedback. IELTS (ADR 0081): the overall band and the four criteria first, then the essay with
 * its fixes marked and numbered beside the criteria, each with why and what lifts it a band.
 * Answers marked on the earlier 1–5 scale open as they were. No list of generic advice.
 */
export function ResultScreen({ submission, onBack, onWriteAgain, onAnother }: Props) {
  const ev = submission.evaluation;
  return (
    <main className={`${styles.screen} ${styles.resultWide}`}>
      <BackButton onClick={onBack} />
      {submission.question?.task_type && (
        <p className={styles.typeChip}>{taskTypeLabel(submission.question.task_type)}</p>
      )}
      {submission.question ? (
        <TappableText
          as="h1"
          className={styles.context}
          text={submission.question.title}
          kind="writing"
          questionId={submission.question.id}
        />
      ) : (
        <h1 className={styles.context}>{t.writing}</h1>
      )}

      {ev && isIelts(ev) && ev.enough_evidence && ev.criteria && ev.band !== null ? (
        <IeltsFeedback submission={submission} ev={ev} />
      ) : ev && !isIelts(ev) && ev.enough_evidence && ev.criteria && ev.overall !== null ? (
        <GeneralFeedback submission={submission} ev={ev} />
      ) : (
        <section aria-labelledby="w-overall" className={styles.verdict}>
          {ev && (
            <header className={styles.verdictHead}>
              <h2 id="w-overall" className={styles.verdictHeading}>
                {t.writingTooLittleHeading}
              </h2>
              <p className={styles.verdictSummary}>{ev.summary}</p>
            </header>
          )}
          <div className={styles.verdictAnswer}>
            <h3 className={styles.paneTitle}>{t.writingYourAnswer}</h3>
            <p className={styles.essay} lang="en">
              {submission.answer}
            </p>
          </div>
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

function IeltsFeedback({ submission, ev }: { submission: Submission; ev: IeltsEvaluation }) {
  const criteria = ev.criteria!;
  const fixes = useMemo(() => collectIeltsFixes(submission.answer, ev), [ev, submission.answer]);
  // Open on the criterion with the lowest band: what most holds the essay back.
  const lowest = IELTS_CRITERIA.reduce((a, b) => (criteria[b].band < criteria[a].band ? b : a));
  const [tab, setTab] = useState<IeltsCriterionName>(lowest);
  const words = ev.words || submission.answer.trim().split(/\s+/).length;

  return (
    <>
      <section className={styles.bandHero} aria-labelledby="w-overall">
        <div className={styles.bandMain}>
          <h2 id="w-overall" className={styles.bandCaption}>
            {t.writingBandOverall}
          </h2>
          <p className={styles.bandValue}>{bandText(ev.band!)}</p>
        </div>
        <ul className={styles.bandChips} aria-label={t.writingBandCriteria}>
          {IELTS_CRITERIA.map((name) => (
            <li key={name}>
              <button
                type="button"
                className={styles.bandChip}
                aria-pressed={tab === name}
                aria-label={`${ieltsLabel(name)}: ${criteria[name].band}`}
                onClick={() => setTab(name)}
              >
                <span>{ieltsShort(name)}</span>
                <strong>{criteria[name].band}</strong>
              </button>
            </li>
          ))}
        </ul>
        <p className={styles.bandMeta}>
          {t.writingWords(words)}
          {submission.time_spent_seconds !== null
            ? ` · ${t.writingTimeSpent(clock(submission.time_spent_seconds))}`
            : ''}
          {words < IELTS_WORDS ? ` · ${t.writingShortForExam(IELTS_WORDS)}` : ''}
        </p>
      </section>

      <Review
        answer={submission.answer}
        fixes={fixes}
        tabs={IELTS_CRITERIA}
        tab={tab}
        onTab={setTab}
        label={ieltsShort}
        head={(name) => (
          <div className={styles.criterionHead}>
            <h3 className={styles.criterionName}>{ieltsLabel(name)}</h3>
            <p className={styles.criterionBand}>
              <strong>{criteria[name].band}</strong> {t.writingBandWord}
            </p>
            <p className={styles.comment}>{criteria[name].why}</p>
            {criteria[name].next_band && criteria[name].band < 9 && (
              <p className={styles.nextBand}>
                <span>{t.writingToNextBand(criteria[name].band + 1)}</span> {criteria[name].next_band}
              </p>
            )}
          </div>
        )}
        empty={() => null}
      />
    </>
  );
}

function GeneralFeedback({ submission, ev }: { submission: Submission; ev: GeneralEvaluation }) {
  const criteria = ev.criteria!;
  const fixes = useMemo(() => collectFixes(submission.answer, ev), [ev, submission.answer]);
  // Open on the category of the first fix in the answer; with no fixes, on the first category.
  const [tab, setTab] = useState<CriterionName>(() => fixes[0]?.home ?? CRITERIA[0]);
  return (
    <>
      <section aria-labelledby="w-overall">
        <h2 id="w-overall" className={styles.visuallyHidden}>
          {t.writingScoreHeading}
        </h2>
        <p className={styles.scoreLine}>
          <strong>{scoreLabel(ev.overall!)}</strong>
          <span>
            {t.writingScoreOutOf(ev.overall!)}
            {ev.cefr_level ? ` · ${t.writingLevel(ev.cefr_level)}` : ''}
            {submission.time_spent_seconds !== null
              ? ` · ${t.writingTimeSpent(clock(submission.time_spent_seconds))}`
              : ''}
          </span>
        </p>
      </section>
      <Review
        answer={submission.answer}
        fixes={fixes}
        tabs={CRITERIA}
        tab={tab}
        onTab={setTab}
        label={criterionLabel}
        head={(name) => (
          <p className={styles.panelScore}>
            <span className={styles.pips} aria-hidden="true">
              {[1, 2, 3, 4, 5].map((n) => (
                <i key={n} className={n <= criteria[name].score ? styles.pipOn : styles.pip} />
              ))}
            </span>
            {scoreLabel(criteria[name].score)} · {t.writingScoreOutOf(criteria[name].score)}
          </p>
        )}
        empty={(name) => <p className={styles.comment}>{criteria[name].comment}</p>}
      />
    </>
  );
}

interface ReviewProps<H extends string> {
  answer: string;
  fixes: Fix<H>[];
  tabs: H[];
  tab: H;
  onTab: (tab: H) => void;
  label: (tab: H) => string;
  /** What the open tab says about itself, above its fixes. */
  head: (tab: H) => ReactNode;
  /** What a tab without fixes shows instead. */
  empty: (tab: H) => ReactNode;
}

/** The answer with its fixes marked and numbered on one side, the criteria as tabs on the other. */
function Review<H extends string>({ answer, fixes, tabs, tab, onTab, label, head, empty }: ReviewProps<H>) {
  const [marked, setMarked] = useState(true);
  const [focus, setFocus] = useState<number | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const items = useRef<Record<number, HTMLLIElement | null>>({});

  // A tap on a mark in the answer opens its criterion and brings its fix into view.
  useEffect(() => {
    if (focus === null) return;
    items.current[focus]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const id = window.setTimeout(() => setFocus(null), 1600);
    return () => window.clearTimeout(id);
  }, [focus, tab]);

  // On a phone the tabs scroll sideways: keep the open one in sight, moving only the tab row.
  useEffect(() => {
    const el = tabRefs.current[tab];
    const row = el?.parentElement;
    if (!el || !row || row.scrollWidth <= row.clientWidth) return;
    const left = el.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft || left + el.offsetWidth > row.scrollLeft + row.clientWidth) {
      row.scrollTo({ left: Math.max(0, left - 16), behavior: 'smooth' });
    }
  }, [tab]);

  const openFix = (fix: Fix<H>) => {
    onTab(fix.home);
    setFocus(fix.n);
  };

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
    onTab(next);
    tabRefs.current[next]?.focus();
  };

  const shown = fixes.filter((f) => f.home === tab);

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
          {tabs.map((name) => (
            <button
              key={name}
              ref={(el) => {
                tabRefs.current[name] = el;
              }}
              type="button"
              role="tab"
              id={`w-tab-${name}`}
              aria-selected={tab === name}
              aria-controls="w-panel"
              tabIndex={tab === name ? 0 : -1}
              className={styles.tab}
              onClick={() => onTab(name)}
              onKeyDown={onTabKey}
            >
              {label(name)}
            </button>
          ))}
        </div>

        <div id="w-panel" role="tabpanel" aria-labelledby={`w-tab-${tab}`} className={styles.panel}>
          {head(tab)}
          {shown.length === 0 ? (
            empty(tab)
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
