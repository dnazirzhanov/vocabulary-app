import { plural } from '../i18n/plural.ts';
import { calendarMonths, type CalendarDay, type Roadmap } from '../lib/roadmap.ts';
import { CheckIcon, FlagIcon } from '../ui/icons.tsx';
import styles from './RoadmapCalendar.module.css';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const monthName = new Intl.DateTimeFormat('ru', { month: 'long' });
// "Ноябрь 2026" (Intl's standalone form would add "г.").
const monthTitle = (year: number, month: number) => {
  const name = monthName.format(new Date(year, month, 1));
  return `${name[0].toUpperCase()}${name.slice(1)} ${year}`;
};
const fullDate = new Intl.DateTimeFormat('ru', { weekday: 'long', day: 'numeric', month: 'long' });
const words = (n: number) => `${n}\u00a0${plural(n, { one: 'слово', few: 'слова', many: 'слов' })}`;

function describe(day: CalendarDay, showCount: boolean): string {
  const parts = [fullDate.format(day.date)];
  if (day.today) parts.push('сегодня');
  if (showCount) parts.push(`вы знаете ${words(day.met)}`);
  if (day.newWords > 0) parts.push(`новых: ${day.newWords}`);
  else if (day.kind === 'plan' && !day.study) parts.push('отдых');
  else if (day.kind === 'plan' && !day.finish) parts.push('только повторения');
  if (day.finish) parts.push('все слова колоды пройдены');
  if (day.allFirm) parts.push('все слова хорошо запомнены');
  return parts.join(', ');
}

/** The plan as a calendar: every day shows how many words the learner will know by its end. */
export function RoadmapCalendar({ roadmap }: { roadmap: Roadmap }) {
  const finish = roadmap.finish?.getTime() ?? Infinity;
  return (
    <div className={styles.calendar}>
      {calendarMonths(roadmap).map((month) => (
        <table key={`${month.year}-${month.month}`} className={styles.month}>
          <caption className={styles.caption}>{monthTitle(month.year, month.month)}</caption>
          <thead>
            <tr>
              {WEEKDAYS.map((weekday) => (
                <th key={weekday} scope="col" className={styles.weekday}>
                  {weekday}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {month.weeks.map((week, index) => (
              <tr key={index}>
                {week.map((day, column) => {
                  if (!day) return <td key={column} className={styles.pad} />;
                  // After the last new word the count stays the same; it is shown muted.
                  const showCount = day.kind === 'plan';
                  const settled = day.date.getTime() > finish;
                  return (
                    <td
                      key={column}
                      className={styles.day}
                      data-kind={day.kind}
                      data-rest={(day.kind === 'plan' && (!day.study || settled)) || undefined}
                      data-new={day.newWords > 0 || undefined}
                      data-today={day.today || undefined}
                      data-finish={day.finish || undefined}
                      data-firm={day.allFirm || undefined}
                      aria-label={describe(day, showCount)}
                    >
                      <span className={styles.date} aria-hidden="true">
                        {day.date.getDate()}
                      </span>
                      {showCount && (
                        <span className={styles.count} aria-hidden="true">
                          {day.met}
                        </span>
                      )}
                      {day.newWords > 0 && !day.finish && (
                        <span className={styles.delta} aria-hidden="true">
                          +{day.newWords}
                        </span>
                      )}
                      {day.finish && <FlagIcon className={styles.mark} />}
                      {day.allFirm && <CheckIcon className={`${styles.mark} ${styles.firmMark}`} />}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      <ul className={styles.legend}>
        <li>
          <i className={styles.swatchNew} aria-hidden="true" /> число — сколько слов вы будете знать к концу дня
        </li>
        <li>
          <i className={styles.swatchRest} aria-hidden="true" /> отдых
        </li>
        <li>
          <i className={styles.swatchFinish} aria-hidden="true">
            <FlagIcon />
          </i>{' '}
          последнее новое слово колоды
        </li>
        <li>
          <i className={styles.swatchFirm} aria-hidden="true">
            <CheckIcon />
          </i>{' '}
          все слова хорошо запомнены
        </li>
      </ul>
    </div>
  );
}
