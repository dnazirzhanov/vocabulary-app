import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, describeError } from '../lib/api.ts';
import { clockText, scoreText, verdictText } from '../lib/groupTests.ts';
import { wordsLabel } from '../lib/pace.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import type { TestAttempt, TestAttemptKind, TestDetail, TestResultRow } from '../lib/types.ts';
import { StateMark } from '../promise/DayDots.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { BackIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import shared from '../groups/Groups.module.css';
import report from '../groups/Group.module.css';
import { TestSetup } from './TestSetup.tsx';
import { useSecondsLeft } from './useSecondsLeft.ts';
import styles from './Tests.module.css';
import { t } from '../i18n/index.ts';

// Results arrive as students finish, and a closed test opens: everyone in the room sees it soon.
const REFRESH_MS = 30_000;

interface DeckTestScreenProps {
  groupId: string;
  deckId: string;
  onRun: (attempt: TestAttempt) => void;
  onBack: () => void;
}

/**
 * One deck's test (ADR 0046): one main action for where things stand, and below it who passed, who
 * didn't and who hasn't taken it yet, by name under the report's headings. Never ranked, nothing red.
 */
export function DeckTestScreen({ groupId, deckId, onRun, onBack }: DeckTestScreenProps) {
  const [detail, setDetail] = useState<TestDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [setting, setSetting] = useState(false);
  const [starting, setStarting] = useState(false);
  const { run, busy, error } = useAsyncAction();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(
    () => api.testDetail(groupId, deckId).then(setDetail, (caught: unknown) => setLoadError(describeError(caught))),
    [groupId, deckId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const hasTest = Boolean(detail?.test);
  useEffect(() => {
    if (!hasTest) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [hasTest, load]);

  const ready = detail !== null;
  useEffect(() => {
    if (ready) headingRef.current?.focus();
  }, [ready]);

  const left = useSecondsLeft(detail?.mine.state === 'running' ? detail.mine.deadline_at : null);
  const expired = left === 0;
  useEffect(() => {
    if (expired) void load();
  }, [expired, load]);

  if (loadError && !detail) {
    return (
      <main className="message-screen">
        <p role="alert">{loadError}</p>
        <PrimaryButton type="button" onClick={() => (setLoadError(null), void load())}>
          {t.tryAgain}
        </PrimaryButton>
      </main>
    );
  }
  if (!detail) {
    return (
      <main className="message-screen" aria-busy="true">
        <p>{t.loading}</p>
      </main>
    );
  }

  const { test, mine, can_manage: manager } = detail;
  const start = (kind: TestAttemptKind) => run(async () => onRun(await api.startTestAttempt(groupId, deckId, kind)));
  const setOpen = (value: boolean) => run(async () => setDetail(await api.openTest(groupId, deckId, value)));

  const running = mine.state === 'running';
  // The one thing to do now; if there is nothing, the state in words.
  let main: ReactNode;
  if (!test) {
    main = manager ? (
      <PrimaryButton type="button" onClick={() => setSetting(true)}>
        {t.setUpTheTest}
      </PrimaryButton>
    ) : (
      <p className={styles.state}>{t.theTestIsnTReadyYet}</p>
    );
  } else if (running) {
    main = (
      <PrimaryButton type="button" disabled={busy} onClick={() => void start('test')}>
        {t.continueTheTest}
        {left !== null && ` · ${clockText(left)}`}
      </PrimaryButton>
    );
  } else if (mine.can_start) {
    main = (
      <>
        {mine.score && (
          <p className={shared.note}>
            {t.lastTime} {scoreText(mine.score)} · {verdictText(mine.score.passed)}
          </p>
        )}
        <PrimaryButton type="button" disabled={busy} onClick={() => setStarting(true)}>
          {t.startTheTest}
        </PrimaryButton>
      </>
    );
  } else if (mine.score) {
    main = (
      <p className={styles.state}>
        {scoreText(mine.score)} · {verdictText(mine.score.passed)}
      </p>
    );
  } else if (manager) {
    main = (
      <PrimaryButton type="button" disabled={busy} onClick={() => void setOpen(true)}>
        {t.openTheTest}
      </PrimaryButton>
    );
  } else {
    main = <p className={styles.state}>{t.theTestIsnTOpenYet}</p>;
  }
  const openIsMain = Boolean(test && !test.is_open && manager && !running && !mine.score);

  return (
    <div className={shared.screen}>
      <header className={shared.topbar}>
        <button type="button" className={shared.back} onClick={onBack}>
          <BackIcon aria-hidden="true" /> {t.tests}
        </button>
      </header>
      <main className={shared.main}>
        <div className={`${shared.column} ${styles.page}`}>
          <div className={styles.head}>
            <h1 ref={headingRef} tabIndex={-1} className={shared.title}>
              {detail.title}
            </h1>
            {test && (
              <p className={shared.note}>{t.testInfo(wordsLabel(test.words), test.minutes, test.pass_percent)}</p>
            )}
          </div>

          <div className={styles.actions}>
            {main}
            {test && !running && (
              <div className={styles.quiet}>
                {manager && !openIsMain && (
                  <button
                    type="button"
                    className={shared.linkButton}
                    disabled={busy}
                    onClick={() => void setOpen(!test.is_open)}
                  >
                    {test.is_open ? t.closeTheTest : t.openTheTest}
                  </button>
                )}
                {/* Closed first: other words erase results, which is no thing to do mid-test. */}
                {manager && !test.is_open && (
                  <button type="button" className={shared.linkButton} onClick={() => setSetting(true)}>
                    {t.setUpTheTest}
                  </button>
                )}
                <button
                  type="button"
                  className={shared.linkButton}
                  disabled={busy}
                  onClick={() => void start('practice')}
                >
                  {mine.practice_attempt_id ? t.continuePractice : t.practice}
                </button>
              </div>
            )}
            {error && (
              <p className={shared.problem} role="alert">
                {error}
              </p>
            )}
          </div>

          <Results title={t.passedIt} state="done" rows={detail.passed} />
          <Results title={t.didnTPass} state="missed" rows={detail.failed} />
          {/* Nobody is behind on a test that has never been open. */}
          {(test?.is_open || detail.passed.length + detail.failed.length > 0) && <NotTaken rows={detail.not_taken} />}
        </div>
      </main>
      <Dialog open={starting} onClose={() => setStarting(false)} title={t.startTestQuestion}>
        <div className={styles.setup}>
          <p>{t.theTimeStartsAtOnceYou}</p>
          <PrimaryButton
            type="button"
            onClick={() => {
              setStarting(false);
              void start('test');
            }}
          >
            {t.startPlain}
          </PrimaryButton>
          <button type="button" className={shared.linkButton} data-autofocus onClick={() => setStarting(false)}>
            {t.cancel}
          </button>
        </div>
      </Dialog>
      {setting && (
        <TestSetup
          groupId={groupId}
          deckId={deckId}
          onClose={() => setSetting(false)}
          onSaved={() => {
            setSetting(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

/** One card, a quiet row a person: their name, and their score as a bar and in words. */
function Results(props: { title: string; state: 'done' | 'missed'; rows: TestResultRow[] }) {
  const { title, state, rows } = props;
  if (rows.length === 0) return null;
  return (
    <section aria-label={title} className={styles.results}>
      <ResultsTitle title={title} state={state} count={rows.length} />
      <ul className={styles.roster}>
        {rows.map((row) => (
          <li key={row.member_id} data-me={row.is_me || undefined} className={styles.person}>
            <Name row={row} />
            {row.score && (
              <>
                <span className={styles.scoreBar} data-short={!row.score.passed || undefined} aria-hidden="true">
                  <span style={{ width: `${(row.score.correct / row.score.total) * 100}%` }} />
                </span>
                <span className={styles.score}>{scoreText(row.score)}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** No score to line up, so names run on in one card: a whole class waiting stays short. */
function NotTaken({ rows }: { rows: TestResultRow[] }) {
  if (rows.length === 0) return null;
  const title = t.havenTTakenIt;
  return (
    <section aria-label={title} className={styles.results}>
      <ResultsTitle title={title} state="off" count={rows.length} />
      <ul className={styles.waiting}>
        {rows.map((row) => (
          <li key={row.member_id}>
            <Name row={row} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ResultsTitle(props: { title: string; state: 'done' | 'missed' | 'off'; count: number }) {
  return (
    <h2 className={report.namesTitle}>
      <StateMark state={props.state} />
      {props.title}: <span className={report.namesCount}>{props.count}</span>
    </h2>
  );
}

function Name({ row }: { row: TestResultRow }) {
  return (
    <span className={styles.name}>
      {row.name}
      {row.is_me && <span className={report.me}>{t.you}</span>}
    </span>
  );
}
