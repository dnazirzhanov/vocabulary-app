import { useCallback, useEffect, useState } from 'react';
import { daysAfterOf, plural, weeksWord } from '../i18n/plural.ts';
import { api, describeError } from '../lib/api.ts';
import { wordsLabel } from '../lib/pace.ts';
import type { Profile } from '../lib/types.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { CheckIcon, FlameIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { AccountSection, type AccountProps } from './AccountSection.tsx';
import styles from './ProfileDialog.module.css';

/** Whose profile: one's own (from the navigation), or a member's (from a group's board). */
export type ProfileTarget = { kind: 'me' } | { kind: 'member'; groupId: string; memberId: string; nickname: string };

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const daysWord = (n: number) => plural(n, { one: 'день', few: 'дня', many: 'дней' });

/**
 * A learner's week against their own promise, and the learning beyond it (ADR 0015). The board
 * ranks only the promise; here extra work is recognised without being compared.
 */
export function ProfileDialog({
  target,
  onClose,
  account,
}: {
  target: ProfileTarget | null;
  onClose: () => void;
  /** One's own profile ends with the account: sign out, delete my data (ADR 0022). */
  account: AccountProps;
}) {
  const title = target?.kind === 'member' ? target.nickname : 'Мой профиль';
  return (
    <Dialog open={target !== null} onClose={onClose} title={title}>
      {target && <ProfileContent target={target} />}
      {target?.kind === 'me' && <AccountSection {...account} />}
    </Dialog>
  );
}

function ProfileContent({ target }: { target: ProfileTarget }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      (target.kind === 'me' ? api.myProfile() : api.memberProfile(target.groupId, target.memberId)).then(
        setProfile,
        (caught: unknown) => setError(describeError(caught)),
      ),
    [target],
  );
  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className={styles.message}>
        <p role="alert">{error}</p>
        <PrimaryButton type="button" onClick={() => (setError(null), void load())}>
          Повторить
        </PrimaryButton>
      </div>
    );
  }
  if (!profile) {
    return (
      <p className={styles.message} aria-busy="true">
        Загружаем…
      </p>
    );
  }

  const { extra } = profile;
  const hasExtra = extra.new_words > 0 || extra.practice_answers > 0;
  return (
    <>
      <p className={styles.promise}>
        Обещание: {profile.promised_days}&nbsp;{daysWord(profile.promised_days)} в неделю по{' '}
        {wordsLabel(profile.words_per_day)}
      </p>

      <section className={styles.week} aria-label="Эта неделя">
        <p className={styles.hero}>
          <strong>{profile.plan_days}</strong>{' '}
          <span>
            из {profile.promised_days}&nbsp;{daysAfterOf(profile.promised_days)} на этой неделе
          </span>
        </p>
        <ol className={styles.dots}>
          {profile.week.map((done, index) => (
            <li
              key={WEEKDAYS[index]}
              data-done={done || undefined}
              data-future={index > profile.today_index || undefined}
              data-today={index === profile.today_index || undefined}
              aria-label={`${WEEKDAYS[index]}: ${done ? 'план выполнен' : 'план не выполнен'}`}
            >
              <span className={styles.dot}>{done && <CheckIcon aria-hidden="true" />}</span>
              <span aria-hidden="true">{WEEKDAYS[index]}</span>
            </li>
          ))}
        </ol>
        {profile.streak_weeks > 0 && (
          <p className={styles.streak}>
            <FlameIcon aria-hidden="true" />
            {profile.streak_weeks}&nbsp;{weeksWord(profile.streak_weeks)} подряд с выполненным обещанием
          </p>
        )}
      </section>

      <dl className={styles.figures}>
        <div>
          <dt>Слов по плану за неделю</dt>
          <dd>{profile.planned_words}</dd>
        </div>
        <div>
          <dt>Всего слов</dt>
          <dd>{profile.words_total.toLocaleString('ru-RU')}</dd>
        </div>
      </dl>

      {hasExtra && (
        <section className={styles.extra} aria-labelledby="extra-title">
          <h3 id="extra-title" className={styles.extraTitle}>
            Сверх плана на этой неделе
          </h3>
          <ul>
            {extra.new_words > 0 && <li>+{wordsLabel(extra.new_words)}</li>}
            {extra.practice_answers > 0 && (
              <li>
                {extra.practice_answers}&nbsp;
                {plural(extra.practice_answers, { one: 'ответ', few: 'ответа', many: 'ответов' })} в тренировке
              </li>
            )}
          </ul>
        </section>
      )}
    </>
  );
}
