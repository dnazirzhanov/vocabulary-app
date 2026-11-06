import { useEffect, useRef, useState } from 'react';
import { BLOCKED, INSTALL, usePushState } from '../account/Reminders.tsx';
import { api } from '../lib/api.ts';
import { PRESETS, wordsLabel } from '../lib/pace.ts';
import { enablePush } from '../lib/push.ts';
import type { Me } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { WeekdayPicker } from '../promise/WeekdayPicker.tsx';
import { BackIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './GoalScreen.module.css';
import { t } from '../i18n/index.ts';

interface GoalScreenProps {
  me: Me;
  onDone: (me: Me) => void;
}

type Step = 'words' | 'days' | 'notify' | 'how';

/** First run: small questions, one at a time, and nothing else (ADR 0042, 0045). */
export function GoalScreen({ me, onDone }: GoalScreenProps) {
  const [step, setStep] = useState<Step>('words');
  const [words, setWords] = useState<number | null>(me.daily_target_words);
  const [weekdays, setWeekdays] = useState(me.promise.pending?.weekdays ?? me.promise.weekdays);
  const [push] = usePushState();
  const { run, busy, error } = useAsyncAction();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Each question starts with focus on its heading, like a new page.
  useEffect(() => headingRef.current?.focus(), [step]);

  // Asked only where saying yes can lead somewhere.
  const asks = push === 'off' || push === 'denied' || push === 'needs_install';

  const finish = async () => {
    // Nothing is finished yet, so the promise applies at once; the pace's answer carries it back.
    await api.setPromise(weekdays);
    onDone(await api.updateMe({ daily_target_words: words ?? undefined }));
  };

  /** A web app can't open a phone's settings: the browser's own question is the way in. */
  const sayYes = () => {
    if (push !== 'off') {
      setStep('how');
      return;
    }
    void run(async () => {
      // Whatever comes of it, the learner goes on: notifications can wait, the app can't.
      await enablePush().catch(() => null);
      await finish();
    });
  };

  const heading = (text: string) => (
    <h1 ref={headingRef} tabIndex={-1} className={styles.heading}>
      {text}
    </h1>
  );
  const problem = error && (
    <p className={styles.error} role="alert">
      {error}
    </p>
  );
  const back: Step | null = step === 'days' ? 'words' : step === 'notify' ? 'days' : step === 'how' ? 'notify' : null;
  const position = step === 'words' ? 0 : step === 'days' ? 1 : 2;
  const total = asks ? 3 : 2;

  return (
    <div className={styles.screen}>
      <header className={styles.topbar}>
        {back ? (
          <button type="button" className={styles.back} onClick={() => setStep(back)}>
            <BackIcon aria-hidden="true" /> {t.back}
          </button>
        ) : (
          <span />
        )}
        <p className={styles.steps}>
          <span className="visually-hidden">{t.questionOf(position + 1, total)}</span>
          {Array.from({ length: total }, (_, index) => (
            <span key={index} aria-hidden="true" className={styles.dot} data-active={index <= position} />
          ))}
        </p>
      </header>

      <main className={styles.main}>
        <div className={styles.question}>
          {step === 'words' && (
            <>
              {heading(t.howManyNewWordsADay)}
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
          )}
          {step === 'days' && (
            <>
              {heading(t.whichDaysWillYouStudy)}
              <WeekdayPicker value={weekdays} onChange={setWeekdays} />
              {problem}
              <PrimaryButton
                type="button"
                disabled={busy}
                aria-busy={busy}
                onClick={() => (asks ? setStep('notify') : void run(finish))}
              >
                {asks ? t.next : busy ? t.saving : t.startPlain}
              </PrimaryButton>
            </>
          )}
          {step === 'notify' && (
            <>
              {heading(t.sendReminders)}
              {problem}
              <div className={styles.options}>
                <button type="button" className={styles.option} disabled={busy} aria-busy={busy} onClick={sayYes}>
                  {t.yes}
                </button>
                <button type="button" className={styles.option} disabled={busy} onClick={() => void run(finish)}>
                  {t.notNow}
                </button>
              </div>
            </>
          )}
          {step === 'how' && (
            <>
              {heading(t.sendReminders)}
              <p className={styles.how}>{push === 'denied' ? BLOCKED : INSTALL}</p>
              {problem}
              <PrimaryButton type="button" disabled={busy} aria-busy={busy} onClick={() => void run(finish)}>
                {t.gotIt}
              </PrimaryButton>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
