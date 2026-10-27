import { useEffect, useId, useRef, type ReactNode } from 'react';
import { CloseIcon } from './icons.tsx';
import styles from './Dialog.module.css';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
}

/**
 * A modal window on the native <dialog>: the browser traps focus, closes it on Escape and gives
 * focus back to the button that opened it. A click on the backdrop closes it too. The content is
 * only mounted while open, so it loads its data when shown.
 */
export function Dialog({ open, onClose, title, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      // A click on the backdrop lands on the dialog element itself, never on its content.
      onClick={(event) => event.target === ref.current && onClose()}
    >
      {open && (
        <div className={styles.body}>
          <header className={styles.head}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            <button type="button" className={styles.close} onClick={onClose} aria-label="Закрыть">
              <CloseIcon aria-hidden="true" />
            </button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  );
}
