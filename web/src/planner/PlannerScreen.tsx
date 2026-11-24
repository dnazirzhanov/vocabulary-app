/**
 * «Планы» (ADR 0084): a plain to-do app, TickTick-style. Today with a week strip, «Предстоящие»,
 * «Входящие»; quick add with typed dates; tick, swipe, edit. Online first: the screen changes at
 * once and saves behind; on a failure it goes back and says so.
 */
import { useCallback, useEffect, useState } from 'react';
import { describeError } from '../lib/api.ts';
import { playTaskDone } from '../lib/sounds.ts';
import { Celebration } from '../ui/Celebration.tsx';
import { t } from '../i18n/index.ts';
import { CardsIcon, CheckIcon, ForwardIcon, PencilIcon, PlusIcon } from '../ui/icons.tsx';
import { tasksApi, type Item, type Scope, type TaskInput } from './api.ts';
import { addDays, localToday, weekday } from './dates.ts';
import { dayLabel } from './DatePicker.tsx';
import { QuickAdd } from './QuickAdd.tsx';
import { Serial } from './queue.ts';
import { loadStudyDay, type StudyItem } from './studyToday.ts';
import { byTime, dayView, inbox, keyOf, openCount, upcoming, type DayView } from './sections.ts';
import { TaskRow } from './TaskRow.tsx';
import { TaskSheet } from './TaskSheet.tsx';
import styles from './Planner.module.css';

type View = 'today' | 'upcoming';
const DAYS = 7;

interface Toast {
  text: string;
  undo?: () => void;
}

interface Props {
  /** Opens a deck's page: where a study item («Учить «…»») leads. */
  onOpenDeck: (deckId: string) => void;
  /** Starts a study item's flashcards or spelling at once (ADR 0089); resolves false if it couldn't. */
  onStartStudy: (item: StudyItem) => Promise<boolean>;
}

export default function PlannerScreen({ onOpenDeck, onStartStudy }: Props) {
  const [today, setToday] = useState(localToday());
  const [items, setItems] = useState<Item[] | null>(null);
  const [view, setView] = useState<View>('today');
  const [day, setDay] = useState(today);
  const [adding, setAdding] = useState<{ text: string; study: boolean } | null>(null);
  const [open, setOpen] = useState<Item | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  // The row just ticked (its sparks), and the day's finish (confetti), for a moment each (ADR 0088).
  const [burst, setBurst] = useState<string | null>(null);
  const [party, setParty] = useState(0);
  const [studyItems, setStudyItems] = useState<StudyItem[] | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  const load = useCallback(
    () =>
      tasksApi.list(localToday(), addDays(localToday(), DAYS - 1)).then(
        (got) => {
          setToday(got.today);
          setItems(got.items);
          setProblem(null);
        },
        () => setProblem(t.planLoadError),
      ),
    [],
  );
  useEffect(() => {
    let live = true;
    tasksApi.list(localToday(), addDays(localToday(), DAYS - 1)).then(
      (got) => {
        if (!live) return;
        setToday(got.today);
        setDay(got.today);
        setItems(got.items);
      },
      () => live && setProblem(t.planLoadError),
    );
    loadStudyDay().then(
      ({ items: got, fresh }) => {
        if (!live) return;
        setStudyItems(got);
        // A deck finished since the last look: its tick is celebrated on the way back (ADR 0089).
        if (fresh.length > 0) {
          setBurst(fresh[0]);
          playTaskDone();
          window.setTimeout(() => live && setBurst(null), 900);
        }
      },
      () => live && setStudyItems([]),
    );
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  // Saves go out one after another, in the order they were made: a tick, «Отменить» and a tick
  // again must reach the server in that order.
  const [serial] = useState(() => new Serial());
  /** Changes the screen at once, then saves behind; a failure says so and shows the server's state. */
  const act = (change: (was: Item[]) => Item[], save: () => Promise<unknown>, reload = false) => {
    setItems((was) => change(was ?? []));
    serial
      .run(save)
      .then(() => (reload ? load() : undefined))
      .catch(async (caught: unknown) => {
        setProblem(describeError(caught) || t.planSaveError);
        await load();
      });
  };
  const replace = (target: Item, next: Partial<Item>) => (was: Item[]) =>
    was.map((i) => (keyOf(i) === keyOf(target) ? { ...i, ...next } : i));

  const shown: DayView | null = items ? dayWithUndated(items, day, today) : null;

  const toggle = (item: Item) => {
    // Ticked by practising: there is no tick of mine to take back.
    if (item.by_practice) return;
    const on = item.on ?? today;
    if (item.state === 'done') {
      void act(replace(item, { state: null }), () => tasksApi.unmark(item.task.id, on));
      return;
    }
    void act(replace(item, { state: 'done' }), () => tasksApi.mark(item.task.id, on));
    navigator.vibrate?.(12);
    // The day's last open task: confetti and the finish chord; any other: a pop and sparks.
    const left = shown ? [...shown.overdue, ...shown.open].filter((i) => keyOf(i) !== keyOf(item)) : [];
    if (shown && day === today && left.length === 0) setParty((n) => n + 1);
    else playTaskDone();
    setBurst(keyOf(item));
    window.setTimeout(() => setBurst((b) => (b === keyOf(item) ? null : b)), 900);
    setToast({
      text: t.planCompleted,
      undo: () => void act(replace(item, { state: null }), () => tasksApi.unmark(item.task.id, on)),
    });
  };
  const skip = (item: Item) => {
    if (!item.on) return;
    setOpen(null);
    void act(replace(item, { state: 'skipped' }), () => tasksApi.mark(item.task.id, item.on!, 'skipped'));
  };
  const moveTo = (item: Item, to: string) => {
    const save = item.task.repeat_mask
      ? () => tasksApi.update(item.task.id, { due_on: to }, 'one', item.on)
      : () => tasksApi.update(item.task.id, { due_on: to });
    void act((was) => was.filter((i) => keyOf(i) !== keyOf(item)), save, true);
  };
  const remove = (item: Item, scope: Scope = 'all') => {
    setOpen(null);
    if (item.task.repeat_mask && scope === 'all' && !open) {
      // A swipe on a repeat: just this day, the safe choice; the sheet offers the rest.
      scope = 'one';
    }
    void act(
      (was) => was.filter((i) => (scope === 'one' ? keyOf(i) !== keyOf(item) : i.task.id !== item.task.id)),
      () => tasksApi.remove(item.task.id, scope, item.on),
      true,
    );
    setToast({ text: t.planDeleted });
  };
  const add = async (input: TaskInput) => {
    await serial.run(() => tasksApi.create(input));
    await load();
  };

  const strip = Array.from({ length: DAYS }, (_, n) => addDays(today, n));
  const heading = view === 'upcoming' ? t.planUpcoming : dayLabel(day, today);

  const rows = (list: Item[]) => (
    <ul className={styles.list}>
      {list.map((item) => (
        <TaskRow
          key={keyOf(item)}
          item={item}
          burst={burst === keyOf(item)}
          today={today}
          onToggle={toggle}
          onOpen={setOpen}
          onTomorrow={(i) => moveTo(i, addDays(today, 1))}
          onDelete={(i) => remove(i)}
        />
      ))}
    </ul>
  );

  return (
    <main className={styles.screen}>
      <header className={styles.head}>
        <h1 className={styles.title}>{heading}</h1>
        <div className={styles.views} role="tablist" aria-label={t.plans}>
          {(
            [
              ['today', t.planToday],
              ['upcoming', t.planUpcoming],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              className={styles.viewTab}
              onClick={() => {
                setView(v);
                if (v === 'today') setDay(today);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {view === 'today' && (
        <div className={styles.strip} role="group" aria-label={t.planDate}>
          {strip.map((d) => (
            <button
              key={d}
              type="button"
              className={styles.stripDay}
              aria-pressed={d === day}
              aria-label={dayLabel(d, today)}
              onClick={() => setDay(d)}
            >
              <span className={styles.stripWeekday}>{t.weekdays[weekday(d)]}</span>
              <span className={styles.stripDate}>{Number(d.slice(8))}</span>
              <span className={styles.stripDot} data-on={items && openCount(items, d) > 0 ? true : undefined} />
            </button>
          ))}
        </div>
      )}

      {problem && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      {items === null && !problem && <p className={styles.muted}>{t.loading}</p>}

      {items && view === 'upcoming' && (
        <div className={styles.body}>
          {upcoming(items, today, DAYS).map(({ day: d, items: list }) => (
            <section key={d} aria-label={dayLabel(d, today)}>
              <h2 className={styles.section}>{dayLabel(d, today)}</h2>
              {rows(list)}
            </section>
          ))}
          {upcoming(items, today, DAYS).length === 0 && <p className={styles.empty}>{t.planUpcomingEmpty}</p>}
        </div>
      )}

      {shown && view === 'today' && (
        <div className={styles.body}>
          {day === today && studyItems && studyItems.length > 0 && (
            <section aria-label={t.planStudyToday}>
              <h2 className={styles.section}>{t.planStudyToday}</h2>
              <ul className={styles.list}>
                {studyItems.map((item) => (
                  <li
                    key={item.key}
                    className={styles.rowWrap}
                    data-done={item.done || undefined}
                    data-burst={burst === item.key || undefined}
                  >
                    <button
                      type="button"
                      className={styles.studyRow}
                      disabled={starting !== null}
                      aria-busy={starting === item.key}
                      onClick={() => {
                        setStarting(item.key);
                        // Straight into the flashcards (or spelling); if that can't start, the deck.
                        void onStartStudy(item).then((started) => {
                          setStarting(null);
                          if (!started) onOpenDeck(item.deckId);
                        });
                      }}
                    >
                      <span
                        className={styles.studyIcon}
                        data-kind={item.kind}
                        data-done={item.done || undefined}
                        aria-hidden="true"
                      >
                        {item.done ? <CheckIcon /> : item.kind === 'learn' ? <CardsIcon /> : <PencilIcon />}
                      </span>
                      <span className={styles.rowBody}>
                        <span className={styles.rowTitle}>
                          {item.kind === 'learn' ? t.planLearnDeck(item.title) : t.planSpellDeck(item.title)}
                        </span>
                        <span className={styles.rowMeta}>
                          {(item.done ? [t.planCompleted] : studyMeta(item, today)).map((part) => (
                            <span key={part} className={styles.metaPart}>
                              {part}
                            </span>
                          ))}
                        </span>
                      </span>
                      <ForwardIcon className={styles.studyGo} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {shown.overdue.length > 0 && (
            <section aria-label={t.planOverdue}>
              <h2 className={styles.section} data-tone="overdue">
                {t.planOverdue}
                <button
                  type="button"
                  className={styles.sectionAction}
                  onClick={() => shown.overdue.forEach((i) => moveTo(i, today))}
                >
                  {t.planMoveToday}
                </button>
              </h2>
              {rows(shown.overdue)}
            </section>
          )}
          {(shown.open.length > 0 || shown.done.length > 0) && (
            <section aria-label={heading}>
              {/* Under «Просрочено», the day's own tasks get their heading, so they aren't read as late. */}
              {shown.overdue.length > 0 && <h2 className={styles.section}>{heading}</h2>}
              {/* Done tasks stay where they are, crossed out (ADR 0088): the day reads as a whole. */}
              {rows([...shown.open, ...shown.done].sort(byTime))}
            </section>
          )}
          {/* «Всё сделано» only when nothing is left: the app's study list counts too. */}
          {shown.open.length === 0 &&
            shown.overdue.length === 0 &&
            !(shown.done.length > 0 && day === today && studyItems?.some((i) => !i.done)) && (
              <div className={styles.emptyBox}>
                <p className={styles.empty}>{shown.done.length > 0 ? t.planAllDone : t.planEmptyDay}</p>
                {shown.done.length === 0 && (
                  <>
                    <p className={styles.muted}>{t.planEmptyHint}</p>
                    <button
                      type="button"
                      className={styles.exampleChip}
                      onClick={() => setAdding({ text: t.planExample, study: true })}
                    >
                      {t.planExample}
                    </button>
                  </>
                )}
              </div>
            )}
        </div>
      )}

      <button
        type="button"
        className={styles.fab}
        aria-label={t.planAdd}
        title={t.planAdd}
        onClick={() => setAdding({ text: '', study: false })}
      >
        <PlusIcon aria-hidden="true" />
      </button>

      {adding !== null && (
        <QuickAdd
          today={today}
          day={view === 'upcoming' ? today : day}
          initial={adding.text}
          study={adding.study}
          onAdd={add}
          onClose={() => setAdding(null)}
        />
      )}
      {open && (
        <TaskSheet
          key={keyOf(open)}
          item={open}
          today={today}
          onClose={() => setOpen(null)}
          onSkip={() => skip(open)}
          onDelete={(scope) => remove(open, scope)}
          onSave={async (patch, scope) => {
            await tasksApi.update(open.task.id, patch, scope, open.on);
            setOpen(null);
            await load();
          }}
        />
      )}
      {party > 0 && <Celebration key={party} />}
      {toast && (
        <div className={styles.toast} role="status">
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              className={styles.toastUndo}
              onClick={() => {
                toast.undo?.();
                setToast(null);
              }}
            >
              {t.planUndo}
            </button>
          )}
        </div>
      )}
    </main>
  );
}

/** «новых: 5 · на повтор: 12 · до 30 нояб. · 7Б», or «слов: 8» for spelling. */
function studyMeta(item: StudyItem, today: string): string[] {
  if (item.kind === 'spell') return [t.planWordsCount(item.dueCount)];
  return [
    item.newCount ? t.planNewWords(item.newCount) : '',
    item.dueCount ? t.planReviewWords(item.dueCount) : '',
    item.dueOn ? t.planDeadline(dayLabel(item.dueOn, today)) : '',
    item.group ?? '',
  ].filter(Boolean);
}

/** A day's list; on today, tasks with no date are today's too (there is no inbox, ADR 0087). */
function dayWithUndated(items: Item[], day: string, today: string): DayView {
  const dayList = dayView(items, day, today);
  if (day !== today) return dayList;
  const undated = inbox(items);
  return {
    overdue: dayList.overdue,
    open: [...dayList.open, ...undated.open],
    done: [...dayList.done, ...undated.done],
  };
}
