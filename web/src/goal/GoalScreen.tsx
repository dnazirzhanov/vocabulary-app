import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import { PRESETS, wordsLabel } from '../lib/pace.ts';
import type { Me } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { WeekdayPicker } from '../promise/WeekdayPicker.tsx';
import { BackIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './GoalScreen.module.css';

interface GoalScreenProps {
  me: Me;
  onDone: (me: Me) => void;
}

/** First run: two small questions, one at a time, and nothing else (ADR 0045). */
export function GoalScreen({ me, onDone }: GoalScreenProps) {
  const [step, setStep] = useState<'words' | 'days'>('words');
  const [words, setWords] = useState<number | null>(me.daily_target_words);
  const [weekdays, setWeekdays] = useState(me.promise.pending?.weekdays ?? me.promise.weekdays);
  const { run, busy, error } = useAsyncAction();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Each question starts with focus on its heading, like a new page.
  useEffect(() => headingRef.current?.focus(), [step]);

  const save = () =>
    run(async () => {
      // Nothing is finished yet, so the promise applies at once; the pace's answer carries it back.
      await api.setPromise(weekdays);
      onDone(await api.updateMe({ daily_target_words: words ?? undefined }));
    });

  return (
    <div className={styles.screen}>
      <header className={styles.topbar}>
        {step === 'days' ? (
          <button type="button" className={styles.back} onClick={() => setStep('words')}>
            <BackIcon aria-hidden="true" /> Назад
          </button>
        ) : (
          <span />
        )}
        <p className={styles.steps}>
          <span className="visually-hidden">Вопрос {step === 'words' ? 1 : 2} из 2</span>
          <span aria-hidden="true" className={styles.dot} data-active="true" />
          <span aria-hidden="true" className={styles.dot} data-active={step === 'days'} />
        </p>
      </header>

      <main className={styles.main}>
        <div className={styles.question}>
          {step === 'words' ? (
            <>
              <h1 ref={headingRef} tabIndex={-1} className={styles.heading}>
                Сколько новых слов в день?
              </h1>
              <div className={styles.options}>
                {PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={styles.option}
                    aria-pressed={words === preset.words}
                    onClick={() => {
                      setWords(preset.words);
                      setStep('days');
                    }}
                  >
                    {wordsLabel(preset.words)}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <h1 ref={headingRef} tabIndex={-1} className={styles.heading}>
                В какие дни будете заниматься?
              </h1>
              <WeekdayPicker value={weekdays} onChange={setWeekdays} />
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
              <PrimaryButton type="button" disabled={busy} aria-busy={busy} onClick={save}>
                {busy ? 'Сохраняем…' : 'Начать'}
              </PrimaryButton>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
