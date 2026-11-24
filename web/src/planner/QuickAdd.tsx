/**
 * Quick add (ADR 0084): one line, as in TickTick. Dates, times and repeats typed in it are found
 * and shown as chips (a tap keeps one as plain text); the buttons below set them by hand. Enter adds
 * the task and keeps the sheet open for the next one.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n/index.ts';
import { CalendarIcon, FlagIcon, SendIcon } from '../ui/icons.tsx';
import type { TaskInput } from './api.ts';
import { DatePicker, whenLabel, type When } from './DatePicker.tsx';
import { parseQuick } from './parse.ts';
import styles from './Planner.module.css';

interface Props {
  today: string;
  /** The day being looked at (null in «Входящие»): where a task with no date typed goes. */
  day: string | null;
  initial?: string;
  onAdd: (input: TaskInput) => Promise<void>;
  onClose: () => void;
}

export function QuickAdd({ today, day, initial = '', onAdd, onClose }: Props) {
  const [text, setText] = useState(initial);
  const [ignore, setIgnore] = useState<string[]>([]);
  // Set by hand with the buttons; it wins over what the line says.
  const [manual, setManual] = useState<When | null>(null);
  const [priority, setPriority] = useState(0);
  const [picking, setPicking] = useState(false);
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
    repeatMask: parsed.repeatMask,
  };
  const title = parsed.title || text.trim();

  const add = async () => {
    if (!title) return;
    // Cleared at once, so the next one can be typed while this one saves; back if it fails.
    const kept = { text, ignore, manual, priority };
    setText('');
    setIgnore([]);
    setManual(null);
    setPriority(0);
    setPicking(false);
    setProblem(false);
    input.current?.focus();
    try {
      await onAdd({
        title,
        due_on: when.dueOn,
        start_minute: when.startMinute,
        repeat_mask: when.repeatMask,
        priority: kept.priority,
      });
    } catch {
      setText((now) => now || kept.text);
      setIgnore(kept.ignore);
      setManual(kept.manual);
      setPriority(kept.priority);
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
        </form>
      </section>
    </div>
  );
}
