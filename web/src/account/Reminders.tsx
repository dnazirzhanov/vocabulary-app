import { useEffect, useState } from 'react';
import { describeError } from '../lib/api.ts';
import { disablePush, enablePush, pushState, type PushState } from '../lib/push.ts';
import styles from './AccountSection.module.css';

/** Where this device stands with reminders; null while asking. */
export function usePushState(): [PushState | null, (next: PushState) => void] {
  const [state, setState] = useState<PushState | null>(null);
  useEffect(() => {
    let live = true;
    pushState().then(
      (found) => live && setState(found),
      () => live && setState('unavailable'),
    );
    return () => {
      live = false;
    };
  }, []);
  return [state, setState];
}

const INSTALL =
  'На iPhone напоминания приходят, только если приложение на экране «Домой»: нажмите «Поделиться» → «На экран „Домой“» и откройте его оттуда.';

/**
 * «Напоминания о сроках» under «Аккаунт» (ADR 0031): a switch where the phone can take them, or
 * what is in the way.
 */
export function Reminders() {
  const [state, setState] = usePushState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (state === null || state === 'unavailable') return null;
  const note =
    state === 'needs_install'
      ? INSTALL
      : state === 'denied'
        ? 'Уведомления запрещены в настройках браузера для этого сайта — разрешите их там.'
        : state === 'unsupported'
          ? 'Этот браузер не умеет показывать напоминания.'
          : 'Вечером, если к сроку учителя на сегодня остались слова. Не чаще раза в день.';
  const toggle = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setState(on ? await enablePush() : await disablePush());
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <label className={styles.toggle}>
        <input
          type="checkbox"
          role="switch"
          checked={state === 'on'}
          disabled={busy || (state !== 'on' && state !== 'off')}
          onChange={(event) => void toggle(event.target.checked)}
        />
        <span>
          Напоминания о сроках
          <small>{note}</small>
        </span>
      </label>
      {error && (
        <p className={styles.errorText} role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** On a deck with a teacher's deadline: the offer to be reminded, while it is not on. */
export function RemindMe() {
  const [state, setState] = usePushState();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (done) return <p className={styles.remindNote}>Напомним вечером, если на сегодня останутся слова.</p>;
  if (state !== 'off') return null;
  return (
    <button
      type="button"
      className={styles.remindButton}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const next = await enablePush();
          setState(next);
          setDone(next === 'on');
        } catch {
          setState('off');
        } finally {
          setBusy(false);
        }
      }}
    >
      Напомнить вечером
    </button>
  );
}
