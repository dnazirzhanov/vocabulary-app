/**
 * «Что наставник знает обо мне» (ADR 0075): everything the mentor remembers, for the learner to
 * see, correct, add to and forget. What they told it, grouped; and what happened with their plan.
 * Nothing about a learner is kept where they can't see it.
 */
import { useEffect, useState } from 'react';
import { api, describeError, FACT_KINDS, type FactKind, type MentorMemory } from '../lib/api.ts';
import { t, uiLanguage } from '../i18n/index.ts';
import { BackIcon, PencilIcon, PlusIcon, TrashIcon } from '../ui/icons.tsx';
import styles from './MemoryScreen.module.css';

export const factKindName = (kind: FactKind): string =>
  ({
    why: t.memoryKindWhy,
    likes: t.memoryKindLikes,
    dislikes: t.memoryKindDislikes,
    constraint: t.memoryKindConstraint,
    energy: t.memoryKindEnergy,
    word: t.memoryKindWord,
    other: t.memoryKindOther,
  })[kind];

/** A timeline event in words. */
function eventText(kind: string, note: Record<string, string | number | null>): string {
  const minutes = typeof note.minutes === 'number' ? note.minutes : 0;
  switch (kind) {
    case 'goal_set':
      return t.memoryEventGoal(String(note.target ?? note.kind ?? ''));
    case 'time_promised':
      return t.memoryEventTime(String(note.start ?? ''), minutes);
    case 'today_changed':
      return note.mode === 'minimum'
        ? t.mentorTodayMinimum
        : note.mode === 'skip'
          ? t.mentorTodaySkippedShort
          : t.memoryEventMoved;
    case 'today_restored':
      return t.memoryEventRestored;
    case 'paused':
      return t.memoryEventPaused(String(note.until ?? ''));
    case 'adjustment_accepted':
      return t.memoryEventAdjustAccepted;
    case 'adjustment_dismissed':
      return t.memoryEventAdjustDismissed;
    default:
      return kind;
  }
}

export function MemoryScreen({ onBack }: { onBack: () => void }) {
  const [memory, setMemory] = useState<MentorMemory | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; kind: FactKind; text: string } | null>(null);

  useEffect(() => {
    api.mentorMemory().then(setMemory, (caught: unknown) => setProblem(describeError(caught)));
  }, []);

  const run = (call: () => Promise<MentorMemory>) => {
    setProblem(null);
    call().then(
      (next) => {
        setMemory(next);
        setEditing(null);
      },
      (caught: unknown) => setProblem(describeError(caught)),
    );
  };

  const save = () => {
    if (!editing || !editing.text.trim()) return;
    const { id, kind, text } = editing;
    run(() => (id ? api.mentorChangeFact(id, kind, text.trim()) : api.mentorAddFact(kind, text.trim())));
  };

  const groups = FACT_KINDS.map((kind) => [kind, memory?.facts.filter((f) => f.kind === kind) ?? []] as const).filter(
    ([, list]) => list.length > 0,
  );

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <button type="button" className={styles.iconButton} onClick={onBack} aria-label={t.back}>
          <BackIcon aria-hidden="true" />
        </button>
        <h1 className={styles.title}>{t.memoryTitle}</h1>
      </header>
      <div className={styles.column}>
        <p className={styles.lead}>{t.memoryLead}</p>
        {problem && (
          <p className={styles.problem} role="alert">
            {problem}
          </p>
        )}

        <section aria-labelledby="memory-facts">
          <div className={styles.sectionHead}>
            <h2 id="memory-facts" className={styles.sectionTitle}>
              {t.memoryFacts}
            </h2>
            <button
              type="button"
              className={styles.add}
              onClick={() => setEditing({ id: null, kind: 'why', text: '' })}
            >
              <PlusIcon aria-hidden="true" /> {t.memoryAdd}
            </button>
          </div>
          {memory && memory.facts.length === 0 && !editing && <p className={styles.muted}>{t.memoryEmpty}</p>}
          {editing && (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                save();
              }}
            >
              <select
                value={editing.kind}
                aria-label={t.memoryKindLabel}
                onChange={(event) => setEditing({ ...editing, kind: event.target.value as FactKind })}
              >
                {FACT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {factKindName(kind)}
                  </option>
                ))}
              </select>
              <input
                value={editing.text}
                maxLength={200}
                placeholder={t.memoryPlaceholder}
                aria-label={t.memoryPlaceholder}
                data-autofocus
                onChange={(event) => setEditing({ ...editing, text: event.target.value })}
              />
              <div className={styles.formActions}>
                <button type="submit" className={styles.primary} disabled={!editing.text.trim()}>
                  {t.eventDialogSave}
                </button>
                <button type="button" className={styles.quiet} onClick={() => setEditing(null)}>
                  {t.cancel}
                </button>
              </div>
            </form>
          )}
          {groups.map(([kind, list]) => (
            <section key={kind} className={styles.group} aria-label={factKindName(kind)}>
              <h3 className={styles.groupTitle}>{factKindName(kind)}</h3>
              <ul className={styles.facts}>
                {list.map((fact) => (
                  <li key={fact.id}>
                    <span className={styles.factText}>{fact.text}</span>
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label={t.memoryEdit(fact.text)}
                      onClick={() => setEditing({ id: fact.id, kind: fact.kind, text: fact.text })}
                    >
                      <PencilIcon aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label={t.memoryForget(fact.text)}
                      onClick={() => run(() => api.mentorForgetFact(fact.id))}
                    >
                      <TrashIcon aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>

        {memory && memory.timeline.length > 0 && (
          <section aria-labelledby="memory-timeline">
            <h2 id="memory-timeline" className={styles.sectionTitle}>
              {t.memoryTimeline}
            </h2>
            <ol className={styles.timeline}>
              {memory.timeline.map((event, i) => (
                <li key={i}>
                  <time dateTime={event.at}>
                    {new Date(event.at).toLocaleDateString(uiLanguage, { day: 'numeric', month: 'short' })}
                  </time>
                  <span>{eventText(event.kind, event.note)}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </main>
  );
}
