import { useState } from 'react';
import { t } from '../i18n/index.ts';
import { api } from '../lib/api.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import styles from './AccountSection.module.css';

/** The translations weren't reviewed by native speakers (ADR 0055): those who read them can say. */
export function ReportWording() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const { run, busy, error } = useAsyncAction();

  if (sent)
    return (
      <p className={styles.wordingNote} role="status">
        {t.wordingThanks}
      </p>
    );
  if (!open) {
    return (
      <button type="button" className={styles.wordingLink} onClick={() => setOpen(true)}>
        {t.wordingQuestion}
      </button>
    );
  }
  return (
    <form
      className={styles.wording}
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          await api.reportWording(text);
          setSent(true);
        });
      }}
    >
      <label>
        {t.wordingHint}
        <textarea
          value={text}
          maxLength={500}
          rows={3}
          required
          autoFocus
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" className={styles.wordingLink} disabled={busy || text.trim() === ''}>
        {t.wordingSend}
      </button>
    </form>
  );
}
