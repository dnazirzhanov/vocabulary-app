import { wordsLabel } from '../lib/pace.ts';
import { buildRoadmap, courseFinish, type RoadmapInput } from '../lib/roadmap.ts';
import { RoadmapCalendar } from './RoadmapCalendar.tsx';
import styles from './RoadmapView.module.css';

const dayMonth = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' });
const dayMonthYear = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', year: 'numeric' });

interface RoadmapViewProps {
  input: RoadmapInput;
  /** The whole course (deck.course_goal.target_words), projected at the same pace. */
  courseWords: number | null;
}

/** The plan: the two dates first, then a calendar with the words known on each day. */
export function RoadmapView({ input, courseWords }: RoadmapViewProps) {
  const roadmap = buildRoadmap(input);
  const date = (day: Date) => (day.getFullYear() === input.today.getFullYear() ? dayMonth : dayMonthYear).format(day);
  const course = courseWords && courseWords > input.totalWords ? courseFinish(input, courseWords) : null;
  const done = input.introduced >= input.totalWords;

  return (
    <section className={styles.view} aria-labelledby="roadmap-title">
      <h2 id="roadmap-title" className="visually-hidden">
        План
      </h2>
      <div className={styles.dates}>
        <p className={styles.date}>
          <span className={styles.dateLabel}>
            {done ? 'Все слова колоды' : `Все ${wordsLabel(input.totalWords)} колоды`}
          </span>
          <strong>{roadmap.finish ? `к ${date(roadmap.finish)}` : done ? 'пройдены' : '—'}</strong>
        </p>
        {roadmap.allFirm && (
          <p className={styles.date}>
            <span className={styles.dateLabel}>Хорошо помните все</span>
            <strong>≈ к {date(roadmap.allFirm)}</strong>
          </p>
        )}
      </div>
      {!done && <RoadmapCalendar roadmap={roadmap} />}
      <p className={styles.note}>
        Если заниматься по плану и повторять в нужные дни.
        {course &&
          ` Весь курс — ${courseWords!.toLocaleString('ru-RU')} слов — при этом темпе ≈ к ${date(course)}; слова добавляются постепенно.`}
      </p>
    </section>
  );
}
