import { useEffect, useState } from 'react';
import { t } from '../i18n/index.ts';
import { type ExerciseStatus, type ShadowingExercise, getExerciseAttempts, listExercises } from './api.ts';
import styles from './ShadowingHome.module.css';

interface ShadowingHomeProps {
  onSelectExercise: (exercise: ShadowingExercise) => void;
  onBack: () => void;
}

function difficultyLabel(d: ShadowingExercise['difficulty']): string {
  if (d === 'beginner') return t.shadowingDifficultyBeginner;
  if (d === 'intermediate') return t.shadowingDifficultyIntermediate;
  return t.shadowingDifficultyAdvanced;
}

function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export function ShadowingHome({ onSelectExercise, onBack }: ShadowingHomeProps) {
  const [exercises, setExercises] = useState<ShadowingExercise[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ExerciseStatus>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listExercises()
      .then(async (exs) => {
        if (cancelled) return;
        setExercises(exs);
        const statusEntries = await Promise.allSettled(
          exs.map((ex) => getExerciseAttempts(ex.id).then((s) => [ex.id, s] as const)),
        );
        if (cancelled) return;
        const map: Record<string, ExerciseStatus> = {};
        for (const result of statusEntries) {
          if (result.status === 'fulfilled') {
            const [id, status] = result.value;
            map[id] = status;
          }
        }
        setStatuses(map);
      })
      .catch(() => {
        if (!cancelled) setError(t.shadowingLoadError);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <button type="button" className={styles.back} onClick={onBack}>
          {t.shadowingBack}
        </button>
        <h1 className={styles.title}>{t.shadowingTitle}</h1>
      </header>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      <ul className={styles.list}>
        {exercises.map((ex) => {
          const status = statuses[ex.id];
          const completed = status != null && status.completed_count > 0;
          return (
            <li key={ex.id}>
              <button type="button" className={styles.exerciseCard} onClick={() => onSelectExercise(ex)}>
                <div className={styles.cardTop}>
                  <span className={styles.exerciseTitle}>{ex.title}</span>
                  {completed && <span className={styles.completedBadge}>{t.shadowingCompletedBadge}</span>}
                </div>
                <p className={styles.exerciseDesc}>{ex.description}</p>
                <div className={styles.exerciseMeta}>
                  <span className={`${styles.difficulty} ${styles[ex.difficulty]}`}>
                    {difficultyLabel(ex.difficulty)}
                  </span>
                  <span className={styles.duration}>{formatDuration(ex.duration_ms)}</span>
                  {status != null && status.attempts_count > 0 && (
                    <span className={styles.attempts}>
                      {status.attempts_count} {t.shadowingAttemptsCount}
                    </span>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
