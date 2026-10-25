import { useCallback, useEffect, useRef, useState } from 'react';
import { plural } from '../i18n/plural.ts';
import { api, describeError } from '../lib/api.ts';
import type { Progress } from '../lib/types.ts';
import { BackIcon, FlameIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { GoalMeter } from './GoalMeter.tsx';
import { WeekChart } from './WeekChart.tsx';
import styles from './ProgressScreen.module.css';

const days = (n: number) => plural(n, { one: 'день', few: 'дня', many: 'дней' });

function Stat({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {note && <span className={styles.statNote}>{note}</span>}
    </div>
  );
}

/** What has been achieved and what is next — honest numbers, no "mastered". */
export function ProgressScreen({ deckId, onBack }: { deckId: string; onBack: () => void }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(
    () => api.deckProgress(deckId).then(setProgress, (caught: unknown) => setError(describeError(caught))),
    [deckId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => headingRef.current?.focus(), [progress]);

  const header = (
    <header className={styles.topbar}>
      <button type="button" className={styles.back} onClick={onBack}>
        <BackIcon /> На главную
      </button>
    </header>
  );

  if (error) {
    return (
      <div className={styles.screen}>
        {header}
        <main className={styles.message}>
          <p role="alert">{error}</p>
          <PrimaryButton
            type="button"
            onClick={() => {
              setError(null);
              void load();
            }}
          >
            Повторить
          </PrimaryButton>
        </main>
      </div>
    );
  }
  if (!progress) {
    return (
      <div className={styles.screen}>
        {header}
        <main className={styles.message} aria-busy="true">
          <p>Загружаем…</p>
        </main>
      </div>
    );
  }

  const { words, recall } = progress;
  const recallPercent = recall.reviewed ? Math.round((recall.recalled / recall.reviewed) * 100) : null;

  return (
    <div className={styles.screen}>
      {header}
      <main className={styles.main}>
        <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
          Прогресс
        </h1>

        <div className={styles.columns}>
          <div className={styles.column}>
            <section className={styles.today} aria-label="Сегодня">
              <GoalMeter value={progress.today.points} goal={progress.daily_goal} />
              <div className={styles.streak}>
                <FlameIcon className={styles.flame} data-active={progress.streak_days > 0 || undefined} />
                <span>
                  <strong>{progress.streak_days}</strong> {days(progress.streak_days)} подряд
                </span>
                <span className={styles.streakNote}>
                  {progress.streak_days > 0 ? 'с выполненной целью' : 'Выполните цель, чтобы начать серию'}
                </span>
              </div>
            </section>

            <section aria-labelledby="words-heading">
              <h2 id="words-heading" className={styles.sectionTitle}>
                Слова
              </h2>
              <div className={styles.stats}>
                <Stat label="Познакомились" value={words.introduced} />
                <Stat label="Повторяете" value={words.reviewing} />
                <Stat label="Сейчас хорошо помните" value={words.well_learned} />
                <Stat label="Ждут повторения" value={words.due} />
              </div>
              <p className={styles.footnote}>
                «Хорошо помните» — слово вспомнили на трёх повторениях подряд, последнее — спустя неделю или больше. Без
                повторений слова забываются, поэтому это состояние, а не навсегда.
              </p>
            </section>
          </div>

          <div className={styles.column}>
            <section className={styles.week}>
              <WeekChart days={progress.week} goal={progress.daily_goal} />
            </section>

            <section aria-labelledby="recall-heading">
              <h2 id="recall-heading" className={styles.sectionTitle}>
                Память
              </h2>
              <div className={styles.pair}>
                <Stat
                  label={`Вспомнили на повторениях за ${recall.days} ${days(recall.days)}`}
                  value={recallPercent === null ? '—' : `${recallPercent}%`}
                  note={
                    recallPercent === null
                      ? 'Появится после первого повторения'
                      : `${recall.recalled} из ${recall.reviewed}`
                  }
                />
                <Stat label="Всего очков" value={progress.points_total} />
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
