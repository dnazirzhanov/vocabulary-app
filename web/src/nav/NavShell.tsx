import type { ReactNode } from 'react';
import { ChartIcon, HomeIcon, PeopleIcon, PersonIcon } from '../ui/icons.tsx';
import styles from './NavShell.module.css';

export type NavTab = 'today' | 'friends' | 'progress';

interface NavShellProps {
  tab: NavTab;
  onNavigate: (tab: NavTab) => void;
  /** «Профиль» opens the learner's own profile window over the current screen. */
  onProfile: () => void;
  children: ReactNode;
}

/**
 * The app's sections around the current screen: a sidebar on desktop and a bottom tab bar on
 * phones. Lessons are outside it.
 */
export function NavShell({ tab, onNavigate, onProfile, children }: NavShellProps) {
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
                onClick={() => onNavigate(target)}
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
