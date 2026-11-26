import { useEffect, useState } from 'react';
import { t } from '../i18n/index.ts';
import { type ExerciseStatus, type ShadowingExercise, getExerciseAttempts, listExercises } from './api.ts';
import { clock } from './oneAtATime.ts';
import styles from './ShadowingHome.module.css';
import { BackButton } from '../ui/BackButton.tsx';

interface ShadowingHomeProps {
  onSelectExercise: (exercise: ShadowingExercise) => void;
  onBack: () => void;
}

function difficultyLabel(d: ShadowingExercise['difficulty']): string {
  if (d === 'beginner') return t.shadowingDifficultyBeginner;
  if (d === 'intermediate') return t.shadowingDifficultyIntermediate;
  return t.shadowingDifficultyAdvanced;
}

/** The exercises as plain rows: the title, then its level and length; a tick once one is saved. */
export function ShadowingHome({ onSelectExercise, onBack }: ShadowingHomeProps) {
  const [exercises, setExercises] = useState<ShadowingExercise[] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, ExerciseStatus>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listExercises()
      .then(async (exs) => {
        if (cancelled) return;
        setExercises(exs);
        const settled = await Promise.allSettled(
          exs.map((ex) => getExerciseAttempts(ex.id).then((s) => [ex.id, s] as const)),
        );
        if (cancelled) return;
        const map: Record<string, ExerciseStatus> = {};
        for (const r of settled) if (r.status === 'fulfilled') map[r.value[0]] = r.value[1];
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
      <BackButton onClick={onBack} />
      <h1 className={styles.title}>{t.shadowingTitle}</h1>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      <ul className={styles.list}>
        {(exercises ?? []).map((ex) => {
          // Only saved attempts count: a cancelled one is not "done".
          const done = (statuses[ex.id]?.completed_count ?? 0) > 0;
          return (
            <li key={ex.id}>
              <button type="button" className={styles.row} onClick={() => onSelectExercise(ex)}>
                <span className={styles.text}>
                  <span className={styles.name}>{ex.title}</span>
                  <span className={styles.meta}>
                    {difficultyLabel(ex.difficulty)} · {clock(ex.duration_ms / 1000)}
                    {done && <span className={styles.done}> · {t.shadowingCompletedBadge}</span>}
                  </span>
                </span>
                <span className={styles.chevron} aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
