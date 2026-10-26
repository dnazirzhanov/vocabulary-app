/**
 * The learner's roadmap: when every word will have been met, and roughly when all of them will be
 * well remembered, at the chosen pace (ADR 0010). Pure and calendar-based, so it can be redrawn on
 * every change of the pace picker.
 *
 * Assumptions, stated in the UI as "если заниматься по плану":
 * - New words come on study days only; today always counts (the learner is here).
 * - Rest days are taken from the weekend first (6 days: Sunday off; 5: the whole weekend).
 * - A word is well remembered after three successful reviews (Leitner stage 4: due 1, 3 and 7 days
 *   after the previous step), each done on the first study day it is due.
 */

const RAMP_MIN_TARGET = 10;
const RAMP_SHARES = [0.5, 0.75];
const FIRM_INTERVALS = [1, 3, 7];
// Rest days are dropped in this order: Sunday, Saturday, Wednesday, Friday, Tuesday, Thursday.
const REST_ORDER = [0, 6, 3, 5, 2, 4];
const MAX_DAYS = 365 * 10;

export interface RoadmapInput {
  /** Local calendar day the forecast starts on. */
  today: Date;
  totalWords: number;
  /** Words already met before today, plus today. */
  introduced: number;
  /** New words already met today (they count toward today's target). */
  metToday: number;
  wordsPerDay: number;
  studyDaysPerWeek: number;
  ramp: boolean;
  /** When the ramp started (onboarding); today when previewing a new plan. */
  rampStartedOn: Date | null;
}

export interface RoadmapDay {
  date: Date;
  study: boolean;
  newWords: number;
  /** Words met by the end of this day. */
  met: number;
  /** Words expected to be well remembered by the end of this day. */
  firm: number;
}

export interface WeekRow {
  start: Date;
  end: Date;
  newWords: number;
  metAtEnd: number;
  /** The daily target in force that week (lower during the ramp). */
  dailyTarget: number;
}

export interface MonthRow {
  /** The last day of the month, or the finish day if earlier. */
  date: Date;
  met: number;
}

export interface Roadmap {
  days: RoadmapDay[];
  /** The day the last new word is met (null if nothing is left or it is too far away). */
  finish: Date | null;
  /** The day the last word should be well remembered. */
  allFirm: Date | null;
  weeks: WeekRow[];
  months: MonthRow[];
}

export const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
export const addDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const daysBetween = (from: Date, to: Date) =>
  Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);
const sameDay = (a: Date, b: Date) => daysBetween(a, b) === 0;

export function restDays(studyDaysPerWeek: number): Set<number> {
  const rest = Math.min(6, Math.max(0, 7 - studyDaysPerWeek));
  return new Set(REST_ORDER.slice(0, rest));
}

/** The target for a given day: half, then three quarters, in the first two weeks of a large target. */
export function targetOn(day: Date, input: Pick<RoadmapInput, 'wordsPerDay' | 'ramp' | 'rampStartedOn'>): number {
  const { wordsPerDay, ramp, rampStartedOn } = input;
  if (!ramp || !rampStartedOn || wordsPerDay < RAMP_MIN_TARGET) return wordsPerDay;
  const week = Math.floor(daysBetween(rampStartedOn, day) / 7);
  if (week < 0 || week >= RAMP_SHARES.length) return wordsPerDay;
  return Math.max(1, Math.ceil(wordsPerDay * RAMP_SHARES[week]));
}

export function buildRoadmap(input: RoadmapInput): Roadmap {
  const today = startOfDay(input.today);
  const rest = restDays(input.studyDaysPerWeek);
  const isStudy = (day: Date) => sameDay(day, today) || !rest.has(day.getDay());
  const nextStudy = (day: Date) => {
    let candidate = day;
    while (!isStudy(candidate)) candidate = addDays(candidate, 1);
    return candidate;
  };
  // When a word met on `day` should be well remembered, with each review on the first study day due.
  const firmDay = (day: Date) => FIRM_INTERVALS.reduce((at, interval) => nextStudy(addDays(at, interval)), day);

  const days: RoadmapDay[] = [];
  const firmCounts = new Map<number, number>(); // day index → words becoming firm that day
  const addFirm = (introducedOn: Date, words: number) => {
    if (words <= 0) return;
    const index = daysBetween(today, firmDay(introducedOn));
    firmCounts.set(index, (firmCounts.get(index) ?? 0) + words);
  };
  // Words met before today: counted as if met today, so their date is never optimistic.
  addFirm(today, input.introduced);

  let met = input.introduced;
  let firm = 0;
  let finish: Date | null = null;
  let lastFirmIndex = met > 0 ? daysBetween(today, firmDay(today)) : -1;
  for (let index = 0; index < MAX_DAYS; index += 1) {
    const date = addDays(today, index);
    const study = isStudy(date);
    let newWords = 0;
    if (study && met < input.totalWords) {
      const target = targetOn(date, input);
      const already = index === 0 ? input.metToday : 0;
      newWords = Math.min(Math.max(0, target - already), input.totalWords - met);
      met += newWords;
      addFirm(date, newWords);
      if (newWords > 0) lastFirmIndex = Math.max(lastFirmIndex, daysBetween(today, firmDay(date)));
      if (met >= input.totalWords && newWords > 0) finish = date;
    }
    firm += firmCounts.get(index) ?? 0;
    days.push({ date, study, newWords, met, firm: Math.min(firm, met) });
    if (met >= input.totalWords && index >= lastFirmIndex) break;
  }

  const allFirm = lastFirmIndex >= 0 && lastFirmIndex < days.length ? days[lastFirmIndex].date : null;
  return { days, finish, allFirm, weeks: weekRows(days, input), months: monthRows(days, finish) };
}

function weekRows(days: RoadmapDay[], input: RoadmapInput): WeekRow[] {
  const rows: WeekRow[] = [];
  for (const day of days) {
    if (day.newWords === 0 && rows.length > 0 && rows[rows.length - 1].metAtEnd >= input.totalWords) break;
    const monday = addDays(day.date, -((day.date.getDay() + 6) % 7));
    let row = rows[rows.length - 1];
    if (!row || !sameDay(row.start, monday)) {
      row = {
        start: monday,
        end: addDays(monday, 6),
        newWords: 0,
        metAtEnd: day.met,
        dailyTarget: targetOn(day.date, input),
      };
      rows.push(row);
    }
    row.newWords += day.newWords;
    row.metAtEnd = day.met;
  }
  return rows.filter((row) => row.newWords > 0);
}

function monthRows(days: RoadmapDay[], finish: Date | null): MonthRow[] {
  const rows: MonthRow[] = [];
  for (const day of days) {
    if (finish && day.date > finish) break;
    const lastOfMonth = addDays(day.date, 1).getDate() === 1;
    if (lastOfMonth || (finish && sameDay(day.date, finish))) rows.push({ date: day.date, met: day.met });
  }
  return rows;
}

/** How long the whole course would take at this pace (a projection: the course is still growing). */
export function courseFinish(input: RoadmapInput, courseWords: number): Date | null {
  if (courseWords <= input.introduced) return null;
  return buildRoadmap({ ...input, totalWords: courseWords }).finish;
}

export interface CalendarDay {
  date: Date;
  /** before: earlier this month · plan: from today to the finish · after: past the finish. */
  kind: 'before' | 'plan' | 'after';
  study: boolean;
  /** Words known by the end of this day, at this pace (plan days only). */
  total: number;
  today: boolean;
  finish: boolean;
  /** A round number of words first reached this day (100, 500, …), if any. */
  milestone: number | null;
}

export interface CalendarMonth {
  year: number;
  month: number;
  /** Monday-first weeks of the whole month; null pads the days outside it. */
  weeks: (CalendarDay | null)[][];
}

export const MILESTONES = [50, 100, 250, 500, 750, 1000, 1500, 2000, 2500];

export interface Milestone {
  words: number;
  date: Date;
  /** The goal itself (the finish), not a round number on the way. */
  goal: boolean;
}

/** The days a round number of words is first reached, then the finish. */
export function milestones(roadmap: Roadmap, goalWords: number, start: number): Milestone[] {
  const result: Milestone[] = [];
  let previous = start;
  for (const day of roadmap.days) {
    for (const words of MILESTONES) {
      if (words < goalWords && previous < words && day.met >= words)
        result.push({ words, date: day.date, goal: false });
    }
    previous = day.met;
  }
  if (roadmap.finish) result.push({ words: goalWords, date: roadmap.finish, goal: true });
  return result;
}

/** Month grids from this month to the finish month: one number per day, the words known by then. */
export function calendarMonths(roadmap: Roadmap, marks: Milestone[] = []): CalendarMonth[] {
  const first = roadmap.days[0];
  if (!first) return [];
  const end = roadmap.finish ?? roadmap.days[roadmap.days.length - 1].date;
  const byDay = new Map(roadmap.days.map((day) => [startOfDay(day.date).getTime(), day]));
  const markOn = new Map(
    marks.filter((mark) => !mark.goal).map((mark) => [startOfDay(mark.date).getTime(), mark.words]),
  );
  const months: CalendarMonth[] = [];
  for (let cursor = new Date(first.date.getFullYear(), first.date.getMonth(), 1); cursor <= end;) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const weeks: (CalendarDay | null)[][] = [];
    let week: (CalendarDay | null)[] = Array((cursor.getDay() + 6) % 7).fill(null);
    for (let date = cursor; date.getMonth() === month; date = addDays(date, 1)) {
      const planned = date <= end ? byDay.get(date.getTime()) : undefined;
      week.push({
        date,
        kind: planned ? 'plan' : date < first.date ? 'before' : 'after',
        study: planned?.study ?? false,
        total: planned?.met ?? 0,
        today: sameDay(date, first.date),
        finish: roadmap.finish !== null && sameDay(date, roadmap.finish),
        milestone: markOn.get(date.getTime()) ?? null,
      });
      if (week.length === 7) {
        weeks.push(week);
        week = [];
      }
    }
    if (week.length > 0) weeks.push([...week, ...Array<null>(7 - week.length).fill(null)]);
    months.push({ year, month, weeks });
    cursor = new Date(year, month + 1, 1);
  }
  return months;
}
