import type { MouseEvent } from 'react';
import { SpeakerIcon } from '../ui/icons.tsx';
import styles from './LessonScreen.module.css';

interface ListenButtonProps {
  onPlay: (event: MouseEvent<HTMLButtonElement>) => void;
  label: string;
  small?: boolean;
}

export function ListenButton({ onPlay, label, small }: ListenButtonProps) {
  return (
    <button
      type="button"
      className={small ? `${styles.listen} ${styles.listenSmall}` : styles.listen}
      onClick={onPlay}
      aria-label={label}
    >
      <SpeakerIcon />
    </button>
  );
}
