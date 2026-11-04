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
    api.me().then(
      (me) => {
        setInfo(me.promise);
        setChosen(me.promise.pending?.weekdays ?? me.promise.weekdays);
      },
      (caught: unknown) => setLoadError(describeError(caught)),
    );
  }, []);

  const show = (next: PromiseInfo) => {
    setInfo(next);
    onChanged?.(next);
  };
  const today = localToday(serverNow());
  const tomorrow = plusDays(today, 1);
  const settled = info ? (info.pending?.weekdays ?? info.weekdays) : [];

  return (
    <Dialog open onClose={onClose} title="Моё обещание">
      {loadError ? (
        <p className={styles.problem} role="alert">
          {loadError}
        </p>
      ) : !info ? (
        <p className={styles.note} aria-busy="true">
          Загружаем…
        </p>
      ) : (
        <>
          <p className={styles.note}>
            В какие дни вы обещаете заниматься. Изменение начнётся с завтрашнего дня: сегодняшний день уже не меняется.
          </p>
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
            Сохранить
          </PrimaryButton>
          {saved && (
            <p className={styles.saved} role="status">
              Сохранено: {promiseText(chosen)}
            </p>
          )}

          <section className={styles.pause} aria-labelledby="pause-title">
            <h3 id="pause-title" className={styles.pauseTitle}>
              Пауза
            </h3>
            {info.pause ? (
              <>
                <p>
                  Пауза с {dueLabel(info.pause.from_date)} по {dueLabel(info.pause.until_date)}.
                </p>
                <button
                  type="button"
                  className={styles.linkButton}
                  disabled={busy}
                  onClick={() => run(async () => show(await api.endPause()))}
                >
                  Снять паузу
                </button>
              </>
            ) : (
              <>
                <p className={styles.note}>Отпуск или болезнь: дни паузы не считаются пропусками. Начинается завтра.</p>
                <div className={styles.pauseRow}>
                  <label className={styles.field}>
                    <span>Пауза до</span>
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
                    Поставить паузу
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
