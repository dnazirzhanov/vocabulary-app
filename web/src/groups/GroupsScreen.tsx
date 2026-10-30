import { useEffect, useRef, useState, type FormEvent } from 'react';
import { plural } from '../i18n/plural.ts';
import { api, describeError } from '../lib/api.ts';
import { suggestNicknames } from '../lib/nickname.ts';
import type { GroupSummary } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { CheckIcon, ForwardIcon, PlusIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { NicknamePicker, nicknameReady } from './NicknamePicker.tsx';
import shared from './Groups.module.css';
import styles from './Friends.module.css';

const membersWord = (n: number) => `${n}\u00a0${plural(n, { one: 'участник', few: 'участника', many: 'участников' })}`;
/** Up to this many faces on a group's row; the rest are counted. */
const FACES = 6;

interface GroupsScreenProps {
  /** `created`: the group was just made, so its invitation is the next thing to show. */
  onOpen: (groupId: string, created: boolean) => void;
  onJoinCode: (code: string) => void;
}

/**
 * «Друзья» (ADR 0023): always the list of my groups first, each with its pulse — my place this
 * week and who has studied today — so a learner in several groups chooses before anything else.
 * Creating a group and joining by code are two quiet buttons that open a window each.
 */
export function GroupsScreen({ onOpen, onJoinCode }: GroupsScreenProps) {
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'create' | 'join' | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    void api.groups().then(setGroups, (caught: unknown) => setLoadError(describeError(caught)));
    headingRef.current?.focus();
  }, []);

  const empty = groups !== null && groups.length === 0;
  return (
    <div className={`${shared.screen} ${shared.root}`}>
      <main className={shared.main}>
        <div className={shared.column}>
          <h1 ref={headingRef} tabIndex={-1} className={shared.title}>
            Друзья
          </h1>
          <p className={styles.lead}>
            {empty
              ? 'Учиться вместе веселее. Создайте группу с друзьями или классом — или войдите по коду приглашения. Только имена в приложении, без e-mail и переписки.'
              : 'Ваши группы. Откройте группу, чтобы увидеть рейтинг и статистику участников.'}
          </p>

          {loadError && <p role="alert">{loadError}</p>}
          {!groups && !loadError && <p aria-busy="true">Загружаем…</p>}
          {groups && groups.length > 0 && (
            <ul className={styles.list}>
              {groups.map((group) => (
                <li key={group.id}>
                  <GroupRow group={group} onOpen={() => onOpen(group.id, false)} />
                </li>
              ))}
            </ul>
          )}

          <div className={styles.actions} data-empty={empty || undefined}>
            {empty ? (
              <PrimaryButton type="button" onClick={() => setDialog('create')}>
                <PlusIcon aria-hidden="true" /> Создать группу
              </PrimaryButton>
            ) : (
              <button type="button" className={shared.secondaryAction} onClick={() => setDialog('create')}>
                <PlusIcon aria-hidden="true" /> Создать группу
              </button>
            )}
            <button type="button" className={shared.secondaryAction} onClick={() => setDialog('join')}>
              Ввести код приглашения
            </button>
          </div>
        </div>
      </main>
      <Dialog open={dialog === 'create'} onClose={() => setDialog(null)} title="Новая группа">
        <CreateGroupForm onCreated={(groupId) => onOpen(groupId, true)} />
      </Dialog>
      <Dialog open={dialog === 'join'} onClose={() => setDialog(null)} title="Войти по коду">
        <JoinCodeForm onJoinCode={onJoinCode} />
      </Dialog>
    </div>
  );
}

/** One group: its name, my place this week, and faces of members — filled once they studied today. */
function GroupRow({ group, onOpen }: { group: GroupSummary; onOpen: () => void }) {
  const today = group.members.filter((member) => member.studied_today).length;
  // Who studied today first, me among them, so the row reads «these people are on it».
  const faces = [...group.members].sort((a, b) => Number(b.studied_today) - Number(a.studied_today));
  const place =
    group.my_rank === null ? 'вы ещё не занимались на этой неделе' : `вы на ${group.my_rank}-м месте на неделе`;
  return (
    <button type="button" className={styles.group} onClick={onOpen}>
      <span className={styles.groupText}>
        <strong>{group.name}</strong>
        <span className={styles.meta}>
          {membersWord(group.member_count)} · {place}
        </span>
      </span>
      <span className={styles.today}>
        <span className={styles.faces} aria-hidden="true">
          {faces.slice(0, FACES).map((member, index) => (
            <i key={index} data-on={member.studied_today || undefined} data-me={member.is_me || undefined}>
              {member.studied_today ? <CheckIcon /> : member.nickname.slice(0, 1).toUpperCase()}
            </i>
          ))}
          {faces.length > FACES && <i data-more="">+{faces.length - FACES}</i>}
        </span>
        <span className={styles.meta}>
          сегодня занимались {today} из {group.member_count}
        </span>
      </span>
      <ForwardIcon className={styles.chevron} aria-hidden="true" />
    </button>
  );
}

function CreateGroupForm({ onCreated }: { onCreated: (groupId: string) => void }) {
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState(() => suggestNicknames(1)[0]);
  const { run, busy, error } = useAsyncAction();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => onCreated((await api.createGroup(name, nickname)).id));
  };
  return (
    <form className={styles.form} onSubmit={submit}>
      <label className={shared.field}>
        <span>Название</span>
        <input
          type="text"
          value={name}
          maxLength={40}
          placeholder="например, 7Б английский"
          onChange={(event) => setName(event.target.value)}
          data-autofocus
        />
      </label>
      <NicknamePicker value={nickname} onChange={setNickname} />
      {error && (
        <p className={shared.problem} role="alert">
          {error}
        </p>
      )}
      <PrimaryButton type="submit" disabled={busy || name.trim().length < 2 || !nicknameReady(nickname)}>
        Создать и пригласить
      </PrimaryButton>
    </form>
  );
}

function JoinCodeForm({ onJoinCode }: { onJoinCode: (code: string) => void }) {
  const [code, setCode] = useState('');
  const clean = code.replace(/[\s-]/g, '').toUpperCase();
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        onJoinCode(clean);
      }}
    >
      <label className={shared.field}>
        <span>Код из 8 символов</span>
        <input
          type="text"
          value={code}
          maxLength={12}
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="ABCD EFGH"
          onChange={(event) => setCode(event.target.value)}
          data-autofocus
        />
      </label>
      <PrimaryButton type="submit" disabled={clean.length !== 8}>
        Найти группу
      </PrimaryButton>
    </form>
  );
}
