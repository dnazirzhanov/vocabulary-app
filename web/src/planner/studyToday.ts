/** Loads «Учёба на сегодня» (ADR 0087) from what the app keeps: works offline too. */
import { api } from '../lib/api.ts';
import type { Deck, Library } from '../lib/types.ts';
import { withSnapshot } from '../local/session.ts';
import { study } from '../study/device.ts';
import { studyToday, type StudyItem } from './studyPlan.ts';

export type { StudyItem };

/** From what the app keeps (works offline too): the course, my and my groups' decks, spelling. */
export async function loadStudyToday(): Promise<StudyItem[]> {
  const [course, library, snapshot] = await Promise.all([
    withSnapshot<Deck[]>('courseDecks', () => api.listDecks())
      .then((r) => r.value)
      .catch(() => []),
    withSnapshot<Library>('library', () => api.library())
      .then((r) => r.value)
      .catch(() => null),
    study.learnerSnapshot().catch(() => null),
  ]);
  return studyToday(course, library, snapshot?.decks ?? []);
}
