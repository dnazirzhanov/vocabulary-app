import { t } from '../i18n/index.ts';
import { BackIcon } from './icons.tsx';
import styles from './BackButton.module.css';

/** «Назад» at the top of a screen: an arrow, not a word (the owner, 22 November 2026). Its name stays
 * «Назад» for screen readers. */
export function BackButton({
  onClick,
  disabled,
  className,
}: {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={className ? `${styles.back} ${className}` : styles.back}
      onClick={onClick}
      disabled={disabled}
      aria-label={t.back}
      title={t.back}
    >
      <BackIcon aria-hidden="true" />
    </button>
  );
}
