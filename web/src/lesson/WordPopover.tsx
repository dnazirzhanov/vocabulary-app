import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { playAudio } from '../lib/audio.ts';
import type { GlossaryEntry } from '../lib/types.ts';
import { SpeakerIcon } from '../ui/icons.tsx';
import styles from './WordPopover.module.css';

interface WordPopoverProps {
  /** The word as written in the sentence. */
  text: string;
  form: string;
  entry: GlossaryEntry | undefined;
  anchor: HTMLElement;
  onClose: () => void;
}

const MARGIN = 12;

/** A small card under a tapped word: its Russian meaning and a button to hear it. A tap anywhere
 * else, Escape or scrolling closes it, and focus goes back to the word. */
export function WordPopover({ text, form, entry, anchor, onClose }: WordPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; above: boolean } | null>(null);

  useLayoutEffect(() => {
    const box = anchor.getBoundingClientRect();
    const card = ref.current?.getBoundingClientRect();
    const width = card?.width ?? 260;
    const height = card?.height ?? 140;
    const left = Math.min(Math.max(MARGIN, box.left + box.width / 2 - width / 2), window.innerWidth - width - MARGIN);
    const above = box.bottom + height + MARGIN > window.innerHeight && box.top > height + MARGIN;
    setPosition({ left, top: above ? box.top - height - 8 : box.bottom + 8, above });
  }, [anchor]);

  useEffect(() => {
    ref.current?.focus();
    const close = () => {
      onClose();
      anchor.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node) && event.target !== anchor) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onClose);
    document.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onClose);
      document.removeEventListener('scroll', onClose, true);
    };
  }, [anchor, onClose]);

  return (
    <div
      ref={ref}
      className={styles.popover}
      role="dialog"
      aria-label={`${text}: перевод`}
      tabIndex={-1}
      data-above={position?.above || undefined}
      style={position ? { top: position.top, left: position.left } : { visibility: 'hidden' }}
    >
      <div className={styles.head}>
        <p className={styles.word} lang="en">
          {text}
        </p>
        <button
          type="button"
          className={styles.listen}
          onClick={() => void playAudio('glossary', form, text)}
          aria-label={`Послушать: ${text}`}
        >
          <SpeakerIcon />
        </button>
      </div>
      {entry ? (
        <>
          <p className={styles.ru}>{entry.ru}</p>
          {entry.lemma && entry.lemma !== form && (
            <p className={styles.meta}>
              словарная форма: <span lang="en">{entry.lemma}</span>
            </p>
          )}
          {entry.note && <p className={styles.meta}>{entry.note}</p>}
        </>
      ) : (
        <p className={styles.meta}>Перевод скоро появится.</p>
      )}
    </div>
  );
}
