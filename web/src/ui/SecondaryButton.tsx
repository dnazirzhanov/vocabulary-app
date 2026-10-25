import type { ComponentProps } from 'react';
import styles from './SecondaryButton.module.css';

export function SecondaryButton({ className, ...props }: ComponentProps<'button'>) {
  return <button {...props} className={className ? `${styles.button} ${className}` : styles.button} />;
}
