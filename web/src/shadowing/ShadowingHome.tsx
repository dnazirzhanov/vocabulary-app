import { useCallback, useEffect, useState } from 'react';
import { t } from '../i18n/index.ts';
import { describeError } from '../lib/api.ts';
import { BackButton } from '../ui/BackButton.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { CloseIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import {
  type ExerciseStatus,
  type ShadowingExercise,
  getExerciseAttempts,
  listExercises,
  removeExercise,
} from './api.ts';
import { clock } from './oneAtATime.ts';
import styles from './ShadowingHome.module.css';
import { levelName } from './YouTubeCreateScreen.tsx';

interface ShadowingHomeProps {
  onSelectExercise: (exercise: ShadowingExercise) => void;
  /** «Из YouTube»: a new exercise from a video (ADR 0097). */
  onNew: () => void;
  onBack: () => void;
}

/**
 * «Из YouTube» first, then my own exercises (with the video's picture), then the ready-made ones
 * and those my groups' tasks give me. A tick once one is done.
 */
export function ShadowingHome({ onSelectExercise, onNew, onBack }: ShadowingHomeProps) {
  const [exercises, setExercises] = useState<ShadowingExercise[] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, ExerciseStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ShadowingExercise | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
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
  useEffect(load, [load]);

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await removeExercise(removing.id);
      setExercises((all) => (all ?? []).filter((e) => e.id !== removing.id));
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setRemoving(null);
      setBusy(false);
    }
  };

  const mine = (exercises ?? []).filter((e) => e.mine);
  const others = (exercises ?? []).filter((e) => !e.mine);

  const row = (ex: ShadowingExercise) => {
    // Only saved attempts count: a cancelled one is not "done".
    const done = (statuses[ex.id]?.completed_count ?? 0) > 0;
    return (
      <li key={ex.id} className={styles.item}>
        <button type="button" className={styles.row} onClick={() => onSelectExercise(ex)}>
          {ex.thumbnail_url && <img className={styles.thumb} src={ex.thumbnail_url} alt="" loading="lazy" />}
          <span className={styles.text}>
            <span className={styles.name}>{ex.title}</span>
            <span className={styles.meta}>
              {levelName(ex.difficulty)} · {clock(ex.duration_ms / 1000)}
              {done && <span className={styles.done}> · {t.shadowingCompletedBadge}</span>}
            </span>
          </span>
          {!ex.mine && (
            <span className={styles.chevron} aria-hidden="true">
              ›
            </span>
          )}
        </button>
        {ex.mine && (
          <button
            type="button"
            className={styles.remove}
            aria-label={t.shRemove(ex.title)}
            onClick={() => setRemoving(ex)}
          >
            <CloseIcon aria-hidden="true" />
          </button>
        )}
      </li>
    );
  };

  return (
    <main className={styles.screen}>
      <BackButton onClick={onBack} />
      <h1 className={styles.title}>{t.shadowingTitle}</h1>

      <button type="button" className={styles.new} onClick={onNew}>
        <span className={styles.newIcon} aria-hidden="true">
          +
        </span>
        <span className={styles.text}>
          <span className={styles.name}>{t.ytFromYouTube}</span>
          <span className={styles.meta}>{t.ytFromYouTubeText}</span>
        </span>
      </button>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      {mine.length > 0 && (
        <section aria-labelledby="sh-mine" className={styles.section}>
          <h2 id="sh-mine" className={styles.sectionTitle}>
            {t.shMine}
          </h2>
          <ul className={styles.list}>{mine.map(row)}</ul>
        </section>
      )}
      {others.length > 0 && (
        <section aria-labelledby="sh-ready" className={styles.section}>
          <h2 id="sh-ready" className={styles.sectionTitle}>
            {t.shReady}
          </h2>
          <ul className={styles.list}>{others.map(row)}</ul>
        </section>
      )}

      <Dialog open={removing !== null} onClose={() => setRemoving(null)} title={t.shRemoveQuestion}>
        <div className={styles.dialog}>
          <p>{t.shRemoveText}</p>
          <PrimaryButton type="button" disabled={busy} aria-busy={busy} onClick={() => void remove()}>
            {t.shRemoveConfirm}
          </PrimaryButton>
          <button type="button" className={styles.keep} data-autofocus onClick={() => setRemoving(null)}>
            {t.shKeep}
          </button>
        </div>
      </Dialog>
    </main>
  );
}
