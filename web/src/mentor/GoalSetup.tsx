import { useState } from 'react';
import { api } from '../lib/api.ts';
import { t } from '../i18n/index.ts';
import type { MentorGoalType } from './types.ts';
import styles from './GoalSetup.module.css';

interface GoalSetupProps {
  initialGoal?: string | null;
  initialMinutes?: number | null;
  onDone: () => void;
}

const GOAL_TYPES: { key: MentorGoalType; label: () => string; emoji: string }[] = [
  { key: 'ielts', label: () => t.mentorGoalTypeIelts, emoji: '🎓' },
  { key: 'conversation', label: () => t.mentorGoalTypeConversation, emoji: '💬' },
  { key: 'travel', label: () => t.mentorGoalTypeTravel, emoji: '✈️' },
  { key: 'business', label: () => t.mentorGoalTypeBusiness, emoji: '💼' },
  { key: 'academic', label: () => t.mentorGoalTypeAcademic, emoji: '📚' },
  { key: 'general', label: () => t.mentorGoalTypeGeneral, emoji: '⭐' },
];

const MINUTE_OPTIONS: { value: number; label: () => string }[] = [
  { value: 10, label: () => t.mentorGoalTime10 },
  { value: 20, label: () => t.mentorGoalTime20 },
  { value: 30, label: () => t.mentorGoalTime30 },
  { value: 60, label: () => t.mentorGoalTime60 },
];

export function GoalSetup({ initialGoal, initialMinutes, onDone }: GoalSetupProps) {
  const [goal, setGoal] = useState<MentorGoalType | null>((initialGoal as MentorGoalType | null) ?? null);
  const [minutes, setMinutes] = useState<number | null>(initialMinutes ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = goal !== null && minutes !== null;

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.mentorSetGoal(goal, minutes);
      onDone();
    } catch {
      setError('Could not save. Try again.');
      setSaving(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <h1 className={styles.heading}>{t.mentorGoalSetupHeading}</h1>
        <p className={styles.sub}>{t.mentorGoalSetupSub}</p>

        <div className={styles.tiles}>
          {GOAL_TYPES.map(({ key, label, emoji }) => (
            <button
              key={key}
              type="button"
              className={`${styles.tile}${goal === key ? ` ${styles.tileSelected}` : ''}`}
              onClick={() => setGoal(key)}
            >
              <span className={styles.tileEmoji} aria-hidden="true">
                {emoji}
              </span>
              <span className={styles.tileLabel}>{label()}</span>
            </button>
          ))}
        </div>

        <p className={styles.timeHeading}>{t.mentorGoalTimeHeading}</p>
        <div className={styles.pills}>
          {MINUTE_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={`${styles.pill}${minutes === value ? ` ${styles.pillSelected}` : ''}`}
              onClick={() => setMinutes(value)}
            >
              {label()}
            </button>
          ))}
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <button
          type="button"
          className={styles.startBtn}
          disabled={!canSave || saving}
          onClick={() => void handleSave()}
        >
          {t.mentorGoalStart}
        </button>
      </div>
    </div>
  );
}
