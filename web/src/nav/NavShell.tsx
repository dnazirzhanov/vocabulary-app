import { useState, type ReactNode } from 'react';
import { AccountSection, type AccountProps } from '../account/AccountSection.tsx';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { ChartIcon, GearIcon, HomeIcon, PeopleIcon } from '../ui/icons.tsx';
import styles from './NavShell.module.css';
import { t } from '../i18n/index.ts';

export type NavTab = 'today' | 'friends' | 'progress';

interface NavShellProps {
  tab: NavTab;
  onNavigate: (tab: NavTab) => void;
  account: AccountProps;
  /** «Выйти» beside the settings, on the opening page; absent in builds with no sign-in. */
  onSignOut?: () => Promise<void>;
  children: ReactNode;
}

/**
 * The app's sections around the current screen: a sidebar on desktop and a bottom tab bar on
 * phones, and the settings in the top corner of every page. Lessons are outside it.
 */
export function NavShell({ tab, onNavigate, account, onSignOut, children }: NavShellProps) {
  const [settings, setSettings] = useState(false);
  const signOut = useAsyncAction();
  const items = [
    { tab: 'today', label: t.today, Icon: HomeIcon },
    { tab: 'friends', label: t.friends, Icon: PeopleIcon },
    { tab: 'progress', label: t.progress, Icon: ChartIcon },
  ] as const;

  return (
    <div className={styles.shell}>
      <div className={styles.content}>
        {children}
        <div className={styles.corner}>
          {onSignOut && (
            <button
              type="button"
              className={styles.signOut}
              disabled={signOut.busy}
              aria-busy={signOut.busy}
              onClick={() => void signOut.run(onSignOut)}
            >
              {signOut.busy ? t.signingOut : t.signOut}
            </button>
          )}
          <button
            type="button"
            className={styles.settings}
            onClick={() => setSettings(true)}
            aria-label={t.settings}
            title={t.settings}
          >
            <GearIcon aria-hidden="true" />
          </button>
        </div>
      </div>
      <nav className={styles.nav} aria-label={t.sections}>
        <p className={styles.brand} aria-hidden="true">
          {t.slovar}
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
        </ul>
      </nav>
      <Dialog open={settings} onClose={() => setSettings(false)} title={t.settings}>
        <AccountSection {...account} />
      </Dialog>
    </div>
  );
}
