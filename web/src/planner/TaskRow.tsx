/**
 * One task in a list (ADR 0084): a round box in its priority's colour, its title, and a line with
 * its time, repeat and date. Swipe right to tick it; swipe left for «На завтра» and «Удалить».
 * Every swipe has a button too, so nothing needs a gesture.
 */
import { useRef, useState, type PointerEvent } from 'react';
import { t } from '../i18n/index.ts';
import { BookIcon, CheckIcon, ClockIcon, ForwardIcon, PeopleIcon, RepeatIcon, TrashIcon } from '../ui/icons.tsx';
import type { Item } from './api.ts';
import { dayLabel, repeatLabel, timeLabel } from './DatePicker.tsx';
import styles from './Planner.module.css';

interface Props {
  item: Item;
  today: string;
  onToggle: (item: Item) => void;
  onOpen: (item: Item) => void;
  onTomorrow: (item: Item) => void;
  onDelete: (item: Item) => void;
}

const SWIPE = 72;
const OPEN = -132;

export function TaskRow({ item, today, onToggle, onOpen, onTomorrow, onDelete }: Props) {
  const [dx, setDx] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const start = useRef<{ x: number; y: number; base: number } | null>(null);
  const moved = useRef(false);
  const done = item.state === 'done';
  const { task } = item;
  // A group's task is the teacher's: it can be ticked here, not moved or deleted.
  const own = !task.group_id;

  const down = (e: PointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY, base: dx };
    moved.current = false;
  };
  const move = (e: PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const x = e.clientX - s.x;
    if (!moved.current && Math.abs(x) < 8) return;
    if (!moved.current && Math.abs(e.clientY - s.y) > Math.abs(x)) {
      start.current = null; // a scroll, not a swipe
      setSwiping(false);
      return;
    }
    moved.current = true;
    setSwiping(true);
    setDx(Math.max(own ? OPEN - 20 : 0, Math.min(SWIPE + 40, s.base + x)));
  };
  const up = () => {
    if (!start.current) return;
    start.current = null;
    setSwiping(false);
    if (dx > SWIPE) {
      setDx(0);
      onToggle(item);
    } else setDx(dx < OPEN / 2 ? OPEN : 0);
  };

  const meta = [
    task.start_minute !== null ? { icon: <ClockIcon />, text: timeLabel(task.start_minute, task.end_minute) } : null,
    item.overdue && item.on ? { icon: null, text: dayLabel(item.on, today) } : null,
    task.repeat_mask ? { icon: <RepeatIcon />, text: repeatLabel(task.repeat_mask) } : null,
    task.group_name ? { icon: <PeopleIcon />, text: task.group_name } : null,
    item.by_practice ? { icon: <BookIcon />, text: t.planByPractice } : null,
  ].filter((m) => m !== null);

  return (
    <li className={styles.rowWrap} data-done={done || undefined} data-open={dx !== 0 || undefined}>
      <div className={styles.rowActions} aria-hidden={dx === 0} hidden={!own}>
        <button
          type="button"
          className={styles.rowActionLater}
          tabIndex={dx ? 0 : -1}
          onClick={() => (setDx(0), onTomorrow(item))}
        >
          <ForwardIcon aria-hidden="true" />
          {t.planMoveTomorrow}
        </button>
        <button
          type="button"
          className={styles.rowActionDelete}
          tabIndex={dx ? 0 : -1}
          onClick={() => (setDx(0), onDelete(item))}
        >
          <TrashIcon aria-hidden="true" />
          {t.planDelete}
        </button>
      </div>
      <div
        className={styles.row}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
        data-swiping={swiping || undefined}
        data-tick={dx > SWIPE || undefined}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          className={styles.check}
          data-priority={task.priority}
          aria-label={done ? t.planUncomplete(task.title) : t.planComplete(task.title)}
          onClick={() => onToggle(item)}
        >
          {done && <CheckIcon aria-hidden="true" />}
        </button>
        <button
          type="button"
          className={styles.rowBody}
          onClick={() => {
            if (moved.current) return;
            if (dx) setDx(0);
            else onOpen(item);
          }}
        >
          <span className={styles.rowTitle}>{task.title}</span>
          {meta.length > 0 && (
            <span className={styles.rowMeta} data-overdue={item.overdue || undefined}>
              {meta.map((m, i) => (
                <span key={i} className={styles.metaPart}>
                  {m.icon && <span aria-hidden="true">{m.icon}</span>}
                  {m.text}
                </span>
              ))}
            </span>
          )}
        </button>
      </div>
    </li>
  );
}
