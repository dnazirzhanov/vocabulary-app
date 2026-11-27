/**
 * Quick add (ADR 0084): one line, as in TickTick. Dates, times and repeats typed in it are found
 * and shown as chips (a tap keeps one as plain text); the buttons below set them by hand. Enter adds
 * the task and keeps the sheet open for the next one. A group's teacher can also attach material:
 * a deck, a reading, an essay, a speaking question or a shadowing exercise (ADR 0096).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n/index.ts';
import { BookIcon, CalendarIcon, ClipIcon, CloseIcon, FlagIcon, SendIcon } from '../ui/icons.tsx';
import type { LinkKind, TaskInput } from './api.ts';
import { kindName, LinkPicker } from './LinkPicker.tsx';
import { DatePicker, whenLabel, type When } from './DatePicker.tsx';
import { parseQuick } from './parse.ts';
import styles from './Planner.module.css';

interface Props {
  today: string;
  /** The day being looked at: where a task with no date typed goes. */
  day: string;
  initial?: string;
  /** Starts as a study task (the empty day's example, ADR 0086). */
  study?: boolean;
  /** A group's tasks: material can be attached (ADR 0096). */
  linkable?: boolean;
  onAdd: (input: TaskInput) => Promise<void>;
  onClose: () => void;
}

type Chosen = { kind: LinkKind; ref: string; title: string };

export function QuickAdd({ today, day, initial = '', study = false, linkable = false, onAdd, onClose }: Props) {
  const [text, setText] = useState(initial);
  const [ignore, setIgnore] = useState<string[]>([]);
  // Set by hand with the buttons; it wins over what the line says.
  const [manual, setManual] = useState<When | null>(null);
  const [priority, setPriority] = useState(0);
  const [kind, setKind] = useState<'task' | 'study'>(study ? 'study' : 'task');
  const [picking, setPicking] = useState(false);
  const [link, setLink] = useState<Chosen | null>(null);
  const [linking, setLinking] = useState(false);
  const [problem, setProblem] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onClose]);

  const parsed = useMemo(() => parseQuick(text, today, ignore), [text, today, ignore]);
  const when: When = manual ?? {
    dueOn: parsed.dueOn ?? day,
    startMinute: parsed.startMinute,
    endMinute: parsed.endMinute,
    repeatMask: parsed.repeatMask,
  };
  const title = parsed.title || text.trim();

  const add = async () => {
    if (!title) return;
    // Cleared at once, so the next one can be typed while this one saves; back if it fails.
    const kept = { text, ignore, manual, priority, link };
    setText('');
    setIgnore([]);
    setManual(null);
    setPriority(0);
    setPicking(false);
    setLink(null);
    setLinking(false);
    setProblem(false);
    input.current?.focus();
    try {
      await onAdd({
        title,
        due_on: when.dueOn,
        start_minute: when.startMinute,
        end_minute: when.endMinute,
        repeat_mask: when.repeatMask,
        priority: kept.priority,
        kind,
        ...(kept.link ? { link: { kind: kept.link.kind, ref: kept.link.ref } } : {}),
      });
    } catch {
      setText((now) => now || kept.text);
      setIgnore(kept.ignore);
      setManual(kept.manual);
      setPriority(kept.priority);
      setLink(kept.link);
      setProblem(true);
    }
  };

  return (
    <div
      className={styles.sheetLayer}
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section className={styles.sheet} role="dialog" aria-modal="true" aria-label={t.planAdd}>
        <form
          className={styles.quickForm}
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <input
            ref={input}
            className={styles.quickInput}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.planAddPlaceholder}
            aria-label={t.planAdd}
            maxLength={200}
            enterKeyHint="done"
          />
          {parsed.found.length > 0 && (
            <div className={styles.foundRow}>
              {parsed.found.map((f) => (
                <button
                  key={f.text}
                  type="button"
                  className={styles.foundChip}
                  data-kind={f.kind}
                  aria-label={t.planKeepAsText(f.text)}
                  title={t.planKeepAsText(f.text)}
                  onClick={() => setIgnore((was) => [...was, f.text])}
                >
                  {f.text}
                </button>
              ))}
            </div>
          )}
          {link && (
            <div className={styles.foundRow}>
              <span className={styles.linkChosen}>
                <ClipIcon aria-hidden="true" />
                <span>
                  {kindName(link.kind)}: {link.title}
                </span>
                <button
                  type="button"
                  className={styles.linkChosenRemove}
                  aria-label={t.linkRemove(link.title)}
                  onClick={() => setLink(null)}
                >
                  <CloseIcon aria-hidden="true" />
                </button>
              </span>
            </div>
          )}
          <div className={styles.quickBar}>
            <button
              type="button"
              className={styles.toolBtn}
              aria-expanded={picking}
              onClick={() => setPicking((p) => !p)}
            >
              <CalendarIcon aria-hidden="true" />
              <span>{whenLabel(when, today)}</span>
            </button>
            <button
              type="button"
              className={styles.toolBtn}
              data-priority={priority}
              aria-label={`${t.planPriority}: ${t.planPriorities[priority]}`}
              title={t.planPriorities[priority]}
              onClick={() => setPriority((p) => (p + 1) % 4)}
            >
              <FlagIcon aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.toolBtn}
              data-study={kind === 'study' || undefined}
              aria-pressed={kind === 'study'}
              aria-label={`${t.planStudy}. ${t.planStudyHint}`}
              title={t.planStudyHint}
              onClick={() => setKind((k) => (k === 'study' ? 'task' : 'study'))}
            >
              <BookIcon aria-hidden="true" />
            </button>
            {linkable && (
              <button
                type="button"
                className={styles.toolBtn}
                aria-expanded={linking}
                data-study={link ? true : undefined}
                aria-label={t.linkMaterial}
                title={t.linkMaterial}
                onClick={() => {
                  setLinking((v) => !v);
                  setPicking(false);
                }}
              >
                <ClipIcon aria-hidden="true" />
              </button>
            )}
            <button
              type="submit"
              className={styles.sendBtn}
              disabled={!title}
              aria-label={t.planAddButton}
              title={t.planAddButton}
            >
              <SendIcon aria-hidden="true" />
            </button>
          </div>
          {problem && (
            <p className={styles.problem} role="alert">
              {t.planSaveError}
            </p>
          )}
          {picking && <DatePicker value={when} today={today} onChange={setManual} />}
          {linking && (
            <LinkPicker
              chosen={link ? `${link.kind}:${link.ref}` : null}
              onPick={(chosen) => {
                setLink(chosen);
                setLinking(false);
                input.current?.focus();
              }}
            />
          )}
        </form>
      </section>
    </div>
  );
}
