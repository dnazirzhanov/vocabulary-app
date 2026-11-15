import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import { t } from '../i18n/index.ts';
import styles from './MentorGoal.module.css';

const MAX_GOAL = 200;

export function MentorGoal() {
  const [goal, setGoal] = useState<string | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.mentorGoal().then(
      ({ goal: g }) => setGoal(g),
      () => setGoal(null),
    );
  }, []);

  function startEdit() {
    setDraft(goal ?? '');
    setEditing(true);
    setJustSaved(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function cancel() {
    setEditing(false);
    setDraft('');
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const { goal: saved } = await api.mentorSetGoal(draft.trim());
      setGoal(saved);
      setEditing(false);
      setDraft('');
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  if (goal === undefined) return null;

  return (
    <div className={styles.wrap}>
      <span className={styles.label}>{t.mentorGoalHeading}</span>
      {editing ? (
        <>
          <div className={styles.editRow}>
            <input
              ref={inputRef}
              className={styles.input}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t.mentorGoalPlaceholder}
              maxLength={MAX_GOAL}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save();
                if (e.key === 'Escape') cancel();
              }}
            />
            <button type="button" className={styles.saveBtn} onClick={() => void save()} disabled={saving}>
              {t.mentorGoalSave}
            </button>
            <button type="button" className={styles.cancelBtn} onClick={cancel}>
              ✕
            </button>
          </div>
          {draft.length >= Math.floor(MAX_GOAL * 0.8) && (
            <p className={styles.counterSoft} role="status">
              {draft.length}/{MAX_GOAL}
            </p>
          )}
        </>
      ) : (
        <div className={styles.displayRow}>
          {goal ? (
            <span className={styles.goalText}>{goal}</span>
          ) : (
            <span className={styles.empty}>{t.mentorGoalPlaceholder}</span>
          )}
          {justSaved ? (
            <span className={styles.saved}>{t.mentorGoalSaved}</span>
          ) : (
            <button type="button" className={styles.editBtn} onClick={startEdit}>
              {t.mentorGoalEdit}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
