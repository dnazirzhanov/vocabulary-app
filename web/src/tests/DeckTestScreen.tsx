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
 * didn't and who hasn't taken it yet, by name in the report's own style. Never ranked, nothing red.
 * A student's weak words come last and are theirs alone.
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
          Повторить
        </PrimaryButton>
      </main>
    );
  }
  if (!detail) {
    return (
      <main className="message-screen" aria-busy="true">
        <p>Загружаем…</p>
      </main>
    );
  }

  const { test, mine, can_manage: manager } = detail;
  const start = (kind: TestAttemptKind, onlyWeak = false) =>
    run(async () => onRun(await api.startTestAttempt(groupId, deckId, kind, onlyWeak)));
  const setOpen = (value: boolean) => run(async () => setDetail(await api.openTest(groupId, deckId, value)));

  const running = mine.state === 'running';
  // The one thing to do now; if there is nothing, the state in words.
  let main: ReactNode;
  if (!test) {
    main = manager ? (
      <PrimaryButton type="button" onClick={() => setSetting(true)}>
        Настроить тест
      </PrimaryButton>
    ) : (
      <p className={styles.state}>Тест ещё не готов</p>
    );
  } else if (running) {
    main = (
      <PrimaryButton type="button" disabled={busy} onClick={() => void start('test')}>
        Продолжить тест{left !== null && ` · ${clockText(left)}`}
      </PrimaryButton>
    );
  } else if (mine.can_start) {
    main = (
      <>
        {mine.score && (
          <p className={shared.note}>
            Прошлый раз: {scoreText(mine.score)} · {verdictText(mine.score.passed)}
          </p>
        )}
        <PrimaryButton type="button" disabled={busy} onClick={() => setStarting(true)}>
          Начать тест
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
        Открыть тест
      </PrimaryButton>
    );
  } else {
    main = <p className={styles.state}>Тест ещё не открыт</p>;
  }
  const openIsMain = Boolean(test && !test.is_open && manager && !running && !mine.score);

  return (
    <div className={shared.screen}>
      <header className={shared.topbar}>
        <button type="button" className={shared.back} onClick={onBack}>
          <BackIcon aria-hidden="true" /> Тесты
        </button>
      </header>
      <main className={shared.main}>
        <div className={`${shared.column} ${styles.page}`}>
          <div className={styles.head}>
            <h1 ref={headingRef} tabIndex={-1} className={shared.title}>
              {detail.title}
            </h1>
            {test && (
              <p className={shared.note}>
                {wordsLabel(test.words)} · {test.minutes} мин · сдать от {test.pass_percent}%
              </p>
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
                    {test.is_open ? 'Закрыть тест' : 'Открыть тест'}
                  </button>
                )}
                {/* Closed first: other words erase results, which is no thing to do mid-test. */}
                {manager && !test.is_open && (
                  <button type="button" className={shared.linkButton} onClick={() => setSetting(true)}>
                    Настроить тест
                  </button>
                )}
                <button
                  type="button"
                  className={shared.linkButton}
                  disabled={busy}
                  onClick={() => void start('practice')}
                >
                  {mine.practice_attempt_id ? 'Продолжить тренировку' : 'Тренировка'}
                </button>
              </div>
            )}
            {error && (
              <p className={shared.problem} role="alert">
                {error}
              </p>
            )}
          </div>

          <Results title="Сдали" state="done" rows={detail.passed} />
          <Results title="Не сдали" state="pending" rows={detail.failed} />
          {/* Nobody is behind on a test that has never been open. */}
          {(test?.is_open || detail.passed.length + detail.failed.length > 0) && (
            <Results title="Ещё не проходили" state="off" rows={detail.not_taken} />
          )}

          {mine.weak.length > 0 && (
            <section aria-labelledby="weak-title" className={styles.weak}>
              <h2 id="weak-title" className={report.namesTitle}>
                Слова для работы: {mine.weak.length}
              </h2>
              <ul className={styles.weakWords}>
                {mine.weak.map((word) => (
                  <li key={word.word}>
                    <strong lang="en">{word.word}</strong> <span>{word.translation}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className={shared.smallButton}
                disabled={busy}
                onClick={() => void start('practice', true)}
              >
                Потренировать
              </button>
            </section>
          )}
        </div>
      </main>
      <Dialog open={starting} onClose={() => setStarting(false)} title="Начать тест?">
        <div className={styles.setup}>
          <p>Время пойдёт сразу. Попытка одна.</p>
          <PrimaryButton
            type="button"
            onClick={() => {
              setStarting(false);
              void start('test');
            }}
          >
            Начать
          </PrimaryButton>
          <button type="button" className={shared.linkButton} data-autofocus onClick={() => setStarting(false)}>
            Отмена
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

function Results(props: { title: string; state: 'done' | 'pending' | 'off'; rows: TestResultRow[] }) {
  const { title, state, rows } = props;
  if (rows.length === 0) return null;
  return (
    <section aria-label={title} className={styles.results}>
      <h2 className={report.namesTitle}>
        <StateMark state={state} />
        {title}: <span className={report.namesCount}>{rows.length}</span>
      </h2>
      <ul className={report.report}>
        {rows.map((row) => (
          <li key={row.member_id} data-me={row.is_me || undefined} className={styles.result}>
            <span className={report.nick}>
              {row.nickname}
              {row.is_me && <span className={report.me}>вы</span>}
            </span>
            {row.score && <span className={styles.score}>{scoreText(row.score)}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
