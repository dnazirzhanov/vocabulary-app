import { wordsLabel } from '../lib/pace.ts';
import { buildRoadmap, courseFinish, type RoadmapInput } from '../lib/roadmap.ts';
import { RoadmapChart } from './RoadmapChart.tsx';
import styles from './RoadmapView.module.css';

const dayMonth = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' });
const dayMonthYear = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', year: 'numeric' });
const short = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' });

interface RoadmapViewProps {
  input: RoadmapInput;
  /** The whole course (deck.course_goal.target_words), projected at the same pace. */
  courseWords: number | null;
}

/** The plan in words and dates first, then the chart, then the numbers by week. */
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
      {!done && <RoadmapChart roadmap={roadmap} total={input.totalWords} />}
      {roadmap.months.length > 1 && (
        <ul className={styles.months}>
          {roadmap.months.map((row) => (
            <li key={row.date.getTime()}>
              к {date(row.date)} — <strong>{wordsLabel(row.met)}</strong>
            </li>
          ))}
        </ul>
      )}
      {roadmap.weeks.length > 0 && (
        <details className={styles.weeks}>
          <summary>План по неделям</summary>
          <table>
            <thead>
              <tr>
                <th scope="col">Неделя</th>
                <th scope="col">В день</th>
                <th scope="col">Новых</th>
                <th scope="col">Всего</th>
              </tr>
            </thead>
            <tbody>
              {roadmap.weeks.map((week) => (
                <tr key={week.start.getTime()}>
                  <td>
                    {short.format(week.start)} – {short.format(week.end)}
                  </td>
                  <td>{week.dailyTarget}</td>
                  <td>+{week.newWords}</td>
                  <td>{week.metAtEnd}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <p className={styles.note}>
        Если заниматься по плану и повторять в нужные дни.
        {course &&
          ` Весь курс — ${courseWords!.toLocaleString('ru-RU')} слов — при этом темпе ≈ к ${date(course)}; слова добавляются постепенно.`}
      </p>
    </section>
  );
}
