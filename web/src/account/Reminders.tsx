import { useEffect, useState } from 'react';
import { api, describeError } from '../lib/api.ts';
import { disablePush, enablePush, pushState, type PushState } from '../lib/push.ts';
import type { Me, NotificationChoice } from '../lib/types.ts';
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

export const INSTALL =
  'На iPhone уведомления приходят, только если приложение на экране «Домой»: нажмите «Поделиться» → «На экран „Домой“» и откройте его оттуда.';
export const BLOCKED = 'Уведомления запрещены в настройках браузера для этого сайта — разрешите их там.';

const CHOICES: { field: NotificationChoice; label: string }[] = [
  { field: 'notify_morning', label: 'Утром: что сегодня по обещанию' },
  { field: 'notify_afternoon', label: 'В 17:00: если сегодня ещё не занимались' },
  { field: 'notify_report', label: 'Отчёт группы за вчера' },
  { field: 'notify_deadline', label: 'Срок колоды' },
];

/** Which notifications this learner wants, on any of their devices (ADR 0042). */
function NotificationChoices() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api.me().then(setMe, (caught: unknown) => setError(describeError(caught)));
  }, []);
  const choose = async (field: NotificationChoice, on: boolean) => {
    setError(null);
    try {
      setMe(await api.updateMe({ [field]: on }));
    } catch (caught) {
      setError(describeError(caught));
    }
  };
  return (
    <fieldset className={styles.choices}>
      <legend className="visually-hidden">Какие уведомления присылать</legend>
      {me &&
        CHOICES.map(({ field, label }) => (
          <label key={field} className={styles.toggle}>
            <input
              type="checkbox"
              role="switch"
              checked={me[field]}
              onChange={(event) => void choose(field, event.target.checked)}
            />
            <span>{label}</span>
          </label>
        ))}
      {error && (
        <p className={styles.errorText} role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/**
 * «Уведомления» in the settings window (ADR 0031, 0042): a switch for this device where it can take
 * them, or what is in the way, and under it which ones to get.
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
        ? BLOCKED
        : state === 'unsupported'
          ? 'Этот браузер не умеет показывать уведомления.'
          : 'На этом устройстве. Не чаще двух раз в день.';
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
    <section aria-label="Уведомления" className={styles.notifications}>
      <label className={styles.toggle}>
        <input
          type="checkbox"
          role="switch"
          checked={state === 'on'}
          disabled={busy || (state !== 'on' && state !== 'off')}
          onChange={(event) => void toggle(event.target.checked)}
        />
        <span>
          Уведомления
          <small>{note}</small>
        </span>
      </label>
      {error && (
        <p className={styles.errorText} role="alert">
          {error}
        </p>
      )}
      {state === 'on' && <NotificationChoices />}
    </section>
  );
}
