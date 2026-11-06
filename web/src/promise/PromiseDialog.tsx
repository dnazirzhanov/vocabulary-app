import { useEffect, useState } from 'react';
import { api, describeError } from '../lib/api.ts';
import { serverNow } from '../lib/clock.ts';
import { dueLabel, localToday } from '../lib/deadline.ts';
import { plusDays, promiseText, sameDays } from '../lib/promise.ts';
import type { PromiseInfo } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { WeekdayPicker } from './WeekdayPicker.tsx';
import styles from './PromiseDialog.module.css';
import { t } from '../i18n/index.ts';

const MAX_PAUSE_DAYS = 31;

/**
 * «Моё обещание» (ADR 0039): the weekdays I promise to study, from tomorrow, and a pause for a
 * holiday or an illness. It loads my promise itself, so «Прогресс» and a group's page open it the
 * same way.
 */
export function PromiseDialog({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged?: (promise: PromiseInfo) => void;
}) {
  const [info, setInfo] = useState<PromiseInfo | null>(null);
  const [chosen, setChosen] = useState<number[]>([]);
  const [until, setUntil] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { run, busy, error } = useAsyncAction();

  useEffect(() => {
    // Only the latest load may fill the form: a later answer must not wipe what was just tapped.
    let current = true;
    api.me().then(
      (me) => {
        if (!current) return;
        setInfo(me.promise);
        setChosen(me.promise.pending?.weekdays ?? me.promise.weekdays);
      },
      (caught: unknown) => {
        if (current) setLoadError(describeError(caught));
      },
    );
    return () => {
      current = false;
    };
  }, []);

  const show = (next: PromiseInfo) => {
    setInfo(next);
    onChanged?.(next);
  };
  const today = localToday(serverNow());
  const tomorrow = plusDays(today, 1);
  const settled = info ? (info.pending?.weekdays ?? info.weekdays) : [];

  return (
    <Dialog open onClose={onClose} title={t.myPromiseTitle}>
      {loadError ? (
        <p className={styles.problem} role="alert">
          {loadError}
        </p>
      ) : !info ? (
        <p className={styles.note} aria-busy="true">
          {t.loading}
        </p>
      ) : (
        <>
          <p className={styles.note}>{t.theDaysYouPromiseToStudy}</p>
          <WeekdayPicker
            value={chosen}
            onChange={(weekdays) => {
              setChosen(weekdays);
              setSaved(false);
            }}
          />
          <PrimaryButton
            type="button"
            disabled={busy || sameDays(chosen, settled)}
            onClick={() =>
              run(async () => {
                show(await api.setPromise(chosen));
                setSaved(true);
              })
            }
          >
            {t.save}
          </PrimaryButton>
          {saved && (
            <p className={styles.saved} role="status">
              {t.saved} {promiseText(chosen)}
            </p>
          )}

          <section className={styles.pause} aria-labelledby="pause-title">
            <h3 id="pause-title" className={styles.pauseTitle}>
              {t.pause}
            </h3>
            {info.pause ? (
              <>
                <p>{t.pauseFromTo(dueLabel(info.pause.from_date), dueLabel(info.pause.until_date))}</p>
                <button
                  type="button"
                  className={styles.linkButton}
                  disabled={busy}
                  onClick={() => run(async () => show(await api.endPause()))}
                >
                  {t.endThePause}
                </button>
              </>
            ) : (
              <>
                <p className={styles.note}>{t.holidayOrIllnessPausedDaysDon}</p>
                <div className={styles.pauseRow}>
                  <label className={styles.field}>
                    <span>{t.pauseUntil}</span>
                    <input
                      type="date"
                      min={tomorrow}
                      max={plusDays(today, MAX_PAUSE_DAYS)}
                      value={until}
                      onChange={(event) => setUntil(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className={styles.outlineButton}
                    disabled={busy || !until}
                    onClick={() =>
                      run(async () => {
                        show(await api.setPause(until));
                        setUntil('');
                      })
                    }
                  >
                    {t.startAPause}
                  </button>
                </div>
              </>
            )}
          </section>
          {error && (
            <p className={styles.problem} role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}
