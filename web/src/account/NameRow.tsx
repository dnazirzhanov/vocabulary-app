import { useId, useState, type FormEvent } from 'react';
import { api } from '../lib/api.ts';
import { NAME_MAX, nameProblem } from '../lib/name.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { ForwardIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import rows from './LanguageRow.module.css';
import styles from './NameRow.module.css';
import { t } from '../i18n/index.ts';

/** My name in settings (ADR 0057): a row like the language ones, opening a field in place. */
export function NameRow({ name, onSaved }: { name: string; onSaved: (name: string) => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(name);
  const { run, busy, error } = useAsyncAction();
  const problem = draft.trim() ? nameProblem(draft) : null;

  const save = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const me = await api.updateMe({ name: draft });
      onSaved(me.name ?? draft);
      setOpen(false);
    });
  };

  return (
    <div className={rows.row}>
      <button
        type="button"
        className={rows.head}
        aria-expanded={open}
        onClick={() => {
          setDraft(name);
          setOpen(!open);
        }}
      >
        <span>{t.yourName}</span>
        <span className={rows.value}>
          {name}
          <ForwardIcon className={rows.chevron} data-open={open || undefined} aria-hidden="true" />
        </span>
      </button>
      {open && (
        <form className={styles.form} onSubmit={save}>
          <input
            type="text"
            className={styles.input}
            value={draft}
            maxLength={NAME_MAX}
            autoComplete="given-name"
            aria-label={t.yourName}
            aria-invalid={problem ? true : undefined}
            aria-describedby={`${id}-note`}
            onChange={(event) => setDraft(event.target.value)}
            autoFocus
          />
          <p
            id={`${id}-note`}
            className={problem || error ? styles.problem : styles.hint}
            role={error ? 'alert' : undefined}
          >
            {problem ?? error ?? t.nameHint}
          </p>
          <PrimaryButton type="submit" disabled={busy || !draft.trim() || problem !== null} aria-busy={busy}>
            {busy ? t.saving : t.save}
          </PrimaryButton>
        </form>
      )}
    </div>
  );
}
