import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, describeError } from '../lib/api.ts';
import type { GroupSummary } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { ForwardIcon, PlusIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import shared from './Groups.module.css';
import styles from './Friends.module.css';
import { t } from '../i18n/index.ts';

interface GroupsScreenProps {
  /** `created`: the group was just made, so its invitation is the next thing to show. */
  onOpen: (groupId: string, created: boolean) => void;
  onJoinCode: (code: string) => void;
}

/**
 * «Друзья» (ADR 0023): always the list of my groups first, each with its pulse — how many kept
 * today's promise and whether I did — so a learner in several groups chooses before anything else.
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
            {t.friends}
          </h1>
          {empty && <p className={styles.lead}>{t.learningTogetherIsMoreFunCreate}</p>}

          {loadError && <p role="alert">{loadError}</p>}
          {!groups && !loadError && <p aria-busy="true">{t.loading}</p>}
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
                <PlusIcon aria-hidden="true" /> {t.createAGroup}
              </PrimaryButton>
            ) : (
              <button type="button" className={shared.secondaryAction} onClick={() => setDialog('create')}>
                <PlusIcon aria-hidden="true" /> {t.createAGroup}
              </button>
            )}
            <button type="button" className={shared.secondaryAction} onClick={() => setDialog('join')}>
              {t.enterAnInviteCode}
            </button>
          </div>
        </div>
      </main>
      <Dialog open={dialog === 'create'} onClose={() => setDialog(null)} title={t.newGroup}>
        <CreateGroupForm onCreated={(groupId) => onOpen(groupId, true)} />
      </Dialog>
      <Dialog open={dialog === 'join'} onClose={() => setDialog(null)} title={t.joinWithACode}>
        <JoinCodeForm onJoinCode={onJoinCode} />
      </Dialog>
    </div>
  );
}

/**
 * One group, one line under its name (ADR 0039): today by the promise — how many did it, and me.
 */
function GroupRow({ group, onOpen }: { group: GroupSummary; onOpen: () => void }) {
  return (
    <button type="button" className={styles.group} onClick={onOpen}>
      <span className={styles.groupText}>
        <strong>{group.name}</strong>
        <span className={styles.meta}>{todayLine(group)}</span>
      </span>
      <ForwardIcon className={styles.chevron} aria-hidden="true" />
    </button>
  );
}

const MINE: Record<GroupSummary['my_today'], string> = {
  done: t.youDoneMark,
  pending: t.youLowerNotYet,
  off: t.yourDayOff,
};

/** «сегодня по обещанию 5 из 7 · вы ✓» */
const todayLine = (group: GroupSummary) =>
  group.today_promised === 0
    ? t.nobodyHasAPromisedLessonToday
    : t.todayByThePromiseOf(group.today_done, group.today_promised, MINE[group.my_today]);

function CreateGroupForm({ onCreated }: { onCreated: (groupId: string) => void }) {
  const [name, setName] = useState('');
  const { run, busy, error } = useAsyncAction();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => onCreated((await api.createGroup(name)).id));
  };
  return (
    <form className={styles.form} onSubmit={submit}>
      <label className={shared.field}>
        <span>{t.name}</span>
        <input
          type="text"
          value={name}
          maxLength={40}
          placeholder={t.forExample7BEnglish}
          onChange={(event) => setName(event.target.value)}
          data-autofocus
        />
      </label>
      {error && (
        <p className={shared.problem} role="alert">
          {error}
        </p>
      )}
      <PrimaryButton type="submit" disabled={busy || name.trim().length < 2}>
        {t.createAndInvite}
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
        <span>{t.an8CharacterCode}</span>
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
        {t.findTheGroup}
      </PrimaryButton>
    </form>
  );
}
