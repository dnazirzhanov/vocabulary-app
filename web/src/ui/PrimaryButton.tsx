import type { ComponentProps } from 'react';
import styles from './PrimaryButton.module.css';

export function PrimaryButton({ className, ...props }: ComponentProps<'button'>) {
  return <button {...props} className={className ? `${styles.button} ${className}` : styles.button} />;
}
