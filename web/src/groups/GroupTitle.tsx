import { useEffect, useRef, useState, type RefObject } from 'react';
import { api } from '../lib/api.ts';
import type { Group } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { PencilIcon, PersonPlusIcon } from '../ui/icons.tsx';
import shared from './Groups.module.css';
import styles from './Group.module.css';

interface GroupTitleProps {
  group: Group;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onInvite: () => void;
  onRenamed: (group: Group) => void;
}

/**
 * The group's name and its two quiet icons (ADR 0040). Whoever may rename it (`can`) gets a pencil
 * that turns the name into a field in place, as on a deck's page; everyone gets «Пригласить».
 */
export function GroupTitle({ group, headingRef, onInvite, onRenamed }: GroupTitleProps) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(group.name);
  const { run, busy, error } = useAsyncAction();
  const refocus = useRef(false);
  const stop = () => {
    refocus.current = true;
    setRenaming(false);
  };
  // Escape closes the form from anywhere: focus can be on the page, not in the form, while saving.
  useEffect(() => {
    if (!renaming) return;
    const close = (event: KeyboardEvent) => event.key === 'Escape' && stop();
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  });
  // The name comes back as a heading once the form is gone: keep the keyboard where it was.
  useEffect(() => {
    if (renaming || !refocus.current) return;
    refocus.current = false;
    headingRef.current?.focus();
  }, [renaming, headingRef]);

  if (renaming) {
    return (
      <form
        className={styles.rename}
        onSubmit={(event) => {
          event.preventDefault();
          const clean = name.trim();
          if (clean.length < 2 || clean === group.name) return stop();
          void run(async () => {
            onRenamed(await api.renameGroup(group.id, clean));
            stop();
          });
        }}
      >
        <label className="visually-hidden" htmlFor="group-name">
          Название группы
        </label>
        <input
          id="group-name"
          value={name}
          maxLength={40}
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
        <div className={styles.renameButtons}>
          <button type="submit" className={styles.renameSave} disabled={busy || name.trim().length < 2}>
            Сохранить
          </button>
          <button type="button" className={styles.renameCancel} onClick={stop}>
            Отмена
          </button>
        </div>
        {error && (
          <p className={shared.problem} role="alert">
            {error}
          </p>
        )}
      </form>
    );
  }

  return (
    <div className={styles.head}>
      <h1 ref={headingRef} tabIndex={-1} className={shared.title}>
        {group.name}
      </h1>
      <div className={styles.headActions}>
        {group.can.includes('rename') && (
          <button
            type="button"
            className={styles.invite}
            onClick={() => (setName(group.name), setRenaming(true))}
            aria-label="Переименовать группу"
            title="Переименовать"
          >
            <PencilIcon aria-hidden="true" />
          </button>
        )}
        <button type="button" className={styles.invite} onClick={onInvite} aria-label="Пригласить" title="Пригласить">
          <PersonPlusIcon aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
