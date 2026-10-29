import type { ReactNode } from 'react';
import { ChartIcon, HomeIcon, PeopleIcon, PersonIcon } from '../ui/icons.tsx';
import styles from './NavShell.module.css';
import { useFriendsTarget } from './useFriendsTarget.ts';

export type NavTab = 'today' | 'friends' | 'progress';

interface NavShellProps {
  tab: NavTab;
  /** Bumped when the groups change, so «Друзья» knows which group to open. */
  version: number;
  /** `groupId`: for friends, the one group to open straight away (null: the list of groups). */
  onNavigate: (tab: NavTab, groupId: string | null) => void;
  /** «Профиль» opens the learner's own profile window over the current screen. */
  onProfile: () => void;
  children: ReactNode;
}

/**
 * The app's sections around the current screen: a sidebar on desktop and a bottom tab bar on
 * phones. Lessons are outside it.
 */
export function NavShell({ tab, version, onNavigate, onProfile, children }: NavShellProps) {
  const friendsGroup = useFriendsTarget(version);
  const items = [
    { tab: 'today', label: 'Сегодня', Icon: HomeIcon },
    { tab: 'friends', label: 'Друзья', Icon: PeopleIcon },
    { tab: 'progress', label: 'Прогресс', Icon: ChartIcon },
  ] as const;

  return (
    <div className={styles.shell}>
      <div className={styles.content}>{children}</div>
      <nav className={styles.nav} aria-label="Разделы">
        <p className={styles.brand} aria-hidden="true">
          Словарь
        </p>
        <ul className={styles.items}>
          {items.map(({ tab: target, label, Icon }) => (
            <li key={target}>
              <button
                type="button"
                className={styles.item}
                aria-current={target === tab ? 'page' : undefined}
                onClick={() => onNavigate(target, target === 'friends' ? friendsGroup : null)}
              >
                <span className={styles.icon}>
                  <Icon aria-hidden="true" />
                </span>
                <span className={styles.label}>{label}</span>
              </button>
            </li>
          ))}
          {/* An action, not a section: it opens a window and the current screen stays. */}
          <li>
            <button type="button" className={styles.item} onClick={onProfile}>
              <span className={styles.icon}>
                <PersonIcon aria-hidden="true" />
              </span>
              <span className={styles.label}>Профиль</span>
            </button>
          </li>
        </ul>
      </nav>
    </div>
  );
}
