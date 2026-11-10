import type { ReactNode } from 'react';
import { ForwardIcon } from './icons.tsx';
import styles from './List.module.css';

/**
 * The one way a screen shows records in a category, as in a phone's settings or a study app's
 * lists: a short label above one rounded group of one-line rows, thin lines between them.
 */
export function ListSection({ title, children, danger }: { title?: string; children: ReactNode; danger?: boolean }) {
  return (
    <section className={styles.section} aria-label={title}>
      {title && (
        <h2 className={styles.title} aria-hidden="true">
          {title}
        </h2>
      )}
      <ul className={styles.group} data-danger={danger || undefined}>
        {children}
      </ul>
    </section>
  );
}

interface RowProps {
  /** What the row is: one or two words. */
  label: ReactNode;
  /** Its current value, on the right (a name, a language, a count). */
  value?: ReactNode;
  icon?: ReactNode;
  /** A control on the right instead of a value and chevron (a switch). */
  trailing?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  ariaLabel?: string;
  /** Opens a dialog, so screen readers say so. */
  dialog?: boolean;
  tone?: 'danger' | 'accent';
}

/** One record: a button when it leads somewhere, otherwise plain (with a switch on the right). */
export function ListRow({ label, value, icon, trailing, onClick, disabled, ariaLabel, dialog, tone }: RowProps) {
  const inside = (
    <>
      {icon && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      <span className={styles.label}>{label}</span>
      {value !== undefined && value !== null && <span className={styles.value}>{value}</span>}
      {trailing ?? (onClick && <ForwardIcon className={styles.chevron} aria-hidden="true" />)}
    </>
  );
  return (
    <li className={styles.item}>
      {onClick ? (
        <button
          type="button"
          className={styles.row}
          data-tone={tone}
          onClick={onClick}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-haspopup={dialog ? 'dialog' : undefined}
        >
          {inside}
        </button>
      ) : (
        <div className={styles.row} data-tone={tone}>
          {inside}
        </div>
      )}
    </li>
  );
}
