import { useEffect, useId, useRef, type ReactNode } from 'react';
import { CloseIcon } from './icons.tsx';
import styles from './Dialog.module.css';
import { t } from '../i18n/index.ts';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
}

/**
 * A modal window on the native <dialog>: the browser traps focus, closes it on Escape and gives
 * focus back to the button that opened it. Content can mark the control to focus first with
 * `data-autofocus` (a confirmation focuses «Отмена», so a reflexive Enter changes nothing). A click on the backdrop closes it too. The content is
 * only mounted while open, so it loads its data when shown.
 */
export function Dialog({ open, onClose, title, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // The browser focuses the first control (the close button); content may name a safer one.
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
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
            <button type="button" className={styles.close} onClick={onClose} aria-label={t.close}>
              <CloseIcon aria-hidden="true" />
            </button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  );
}
