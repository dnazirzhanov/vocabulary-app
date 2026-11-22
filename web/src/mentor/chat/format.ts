/** Small pure helpers for the mentor chat: times, the sidebar's groups, titles. */

/** Minutes from midnight → «19:05». */
export function hhmm(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

interface Timed {
  title: string;
  weekdays: number[];
  start_minute: number;
  end_minute: number;
  on_date: string | null;
}

/**
 * The two halves the server saves a night as (23:00–24:00, then 00:00–07:00 the day after) shown
 * again as the one block the learner said: «Сон 23:00–07:00».
 */
export function joinOvernight<T extends Timed>(blocks: T[]): T[] {
  const used = new Set<number>();
  const shown: T[] = [];
  blocks.forEach((evening, i) => {
    if (used.has(i)) return;
    const next = evening.weekdays.map((d) => (d + 1) % 7).sort();
    const j = blocks.findIndex(
      (morning, k) =>
        k !== i &&
        !used.has(k) &&
        evening.end_minute === 1440 &&
        morning.start_minute === 0 &&
        evening.on_date === null &&
        morning.on_date === null &&
        morning.title === evening.title &&
        [...morning.weekdays].sort().join() === next.join(),
    );
    if (j === -1) {
      shown.push(evening);
      return;
    }
    used.add(j);
    shown.push({ ...evening, end_minute: blocks[j].end_minute });
  });
  return shown;
}

/** A message's time by the learner's own clock: today «19:05», another day «18 нояб., 19:05». */
export function messageTime(sent: Date, now: Date, locale: string): string {
  const time = sent.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (sent.toDateString() === now.toDateString()) return time;
  return `${sent.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}, ${time}`;
}

export type ChatGroup = 'today' | 'yesterday' | 'week' | 'earlier';

/** Which of the sidebar's groups a chat falls in, by the learner's calendar days. */
export function groupOf(updated: Date, now: Date): ChatGroup {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(updated)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return 'week';
  return 'earlier';
}

/** Chats in their groups, newest first, groups in order, empty groups left out. */
export function grouped<T extends { updated_at: string }>(chats: T[], now: Date): [ChatGroup, T[]][] {
  const order: ChatGroup[] = ['today', 'yesterday', 'week', 'earlier'];
  const by = new Map<ChatGroup, T[]>();
  for (const chat of [...chats].sort((a, b) => b.updated_at.localeCompare(a.updated_at))) {
    const group = groupOf(new Date(chat.updated_at), now);
    by.set(group, [...(by.get(group) ?? []), chat]);
  }
  return order.filter((g) => by.has(g)).map((g) => [g, by.get(g)!]);
}

/** A chat's working title before the server names it: the first question, cut at a word. */
export function titleOf(message: string, max = 60): string {
  const flat = message.split(/\s+/).filter(Boolean).join(' ');
  if (flat.length <= max) return flat || '…';
  return `${flat.slice(0, max).replace(/\s+\S*$/, '') || flat.slice(0, max)}…`;
}
