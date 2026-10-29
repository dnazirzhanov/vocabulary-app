import { useEffect, useRef, useState, type FormEvent } from 'react';
import { plural } from '../i18n/plural.ts';
import { api, describeError } from '../lib/api.ts';
import { suggestNicknames } from '../lib/nickname.ts';
import type { Group } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { NicknamePicker, nicknameReady } from './NicknamePicker.tsx';
import styles from './Groups.module.css';

const members = (n: number) => `${n}\u00a0${plural(n, { one: 'участник', few: 'участника', many: 'участников' })}`;

interface GroupsScreenProps {
  /** `created`: the group was just made, so its invitation is the next thing to show. */
  onOpen: (groupId: string, created: boolean) => void;
  onJoinCode: (code: string) => void;
}

/** The learner's groups, plus creating one or joining by code. */
export function GroupsScreen({ onOpen, onJoinCode }: GroupsScreenProps) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState(() => suggestNicknames(1)[0]);
  const [code, setCode] = useState('');
  const { run, busy, error } = useAsyncAction();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    void api.groups().then(setGroups, (caught: unknown) => setLoadError(describeError(caught)));
    headingRef.current?.focus();
  }, []);

  const create = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => onOpen((await api.createGroup(name, nickname)).id, true));
  };
  const cleanCode = code.replace(/[\s-]/g, '').toUpperCase();

  return (
    <div className={`${styles.screen} ${styles.root}`}>
      <main className={styles.main}>
        <div className={styles.column}>
          <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
            Друзья
          </h1>
          <p className={styles.lead}>
            Учиться вместе веселее: в группе видно, кто сколько дней занимался на этой неделе. Только имена в приложении
            — никаких e-mail и переписки.
          </p>

          {loadError && <p role="alert">{loadError}</p>}
          {groups && groups.length > 0 && (
            <ul className={styles.groupList}>
              {groups.map((group) => (
                <li key={group.id}>
                  <button type="button" className={styles.groupCard} onClick={() => onOpen(group.id, false)}>
                    <strong>{group.name}</strong>
                    <span>
                      {members(group.member_count)} · вы — {group.nickname}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form className={styles.card} onSubmit={create}>
            <h2 className={styles.sectionTitle}>Создать группу</h2>
            <label className={styles.field}>
              <span>Название</span>
              <input
                type="text"
                value={name}
                maxLength={40}
                placeholder="например, 7Б английский"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <NicknamePicker value={nickname} onChange={setNickname} />
            {error && (
              <p className={styles.problem} role="alert">
                {error}
              </p>
            )}
            <PrimaryButton type="submit" disabled={busy || name.trim().length < 2 || !nicknameReady(nickname)}>
              Создать и пригласить
            </PrimaryButton>
          </form>

          <form
            className={styles.card}
            onSubmit={(event) => {
              event.preventDefault();
              onJoinCode(cleanCode);
            }}
          >
            <h2 className={styles.sectionTitle}>Есть код приглашения?</h2>
            <label className={styles.field}>
              <span>Код из 8 символов</span>
              <input
                type="text"
                value={code}
                maxLength={12}
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="ABCD EFGH"
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <button type="submit" className={styles.secondaryAction} disabled={cleanCode.length !== 8}>
              Найти группу
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
