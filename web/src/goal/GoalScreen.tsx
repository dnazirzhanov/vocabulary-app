import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import { dailyMinutes, DEFAULT_SECONDS_PER_EXERCISE, formatMinutes, RAMP_MIN_TARGET, wordsLabel } from '../lib/pace.ts';
import type { Me } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { BackIcon, CheckIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import type { Course } from '../lib/course.ts';
import { CoverageSentence } from './CoverageSentence.tsx';
import { PacePicker, type PaceChoice } from './PacePicker.tsx';
import styles from './GoalScreen.module.css';

/** First run: the promise, then the pace. */
interface GoalScreenProps {
  course: Course;
  me: Me;
  onDone: (me: Me) => void;
}

const thousands = (n: number) => n.toLocaleString('ru-RU');

function CoursePromise({ course }: { course: Course }) {
  const goal = course.course_goal;
  return (
    <>
      <p className={styles.eyebrow}>Ваша цель</p>
      <h1 className={styles.title} tabIndex={-1} data-autofocus>
        {goal ? `${thousands(goal.target_words)} слов` : 'Самые нужные слова'}
      </h1>
      <p className={styles.subtitle}>
        {goal
          ? `— это около ${goal.coverage_percent}% всех слов, которые встречаются в обычных английских текстах.`
          : 'Слова, без которых не обойтись в обычных английских текстах.'}
      </p>
      <ul className={styles.points}>
        <li>
          <CheckIcon aria-hidden="true" />
          <span>
            <strong>Не нужно искать, что учить.</strong> Слова уже выбраны по частоте и стоят в правильном порядке.
          </span>
        </li>
        <li>
          <CheckIcon aria-hidden="true" />
          <span>
            <strong>Слова не забываются.</strong> Приложение само напоминает повторить каждое слово в нужный день.
          </span>
        </li>
        <li>
          <CheckIcon aria-hidden="true" />
          <span>
            <strong>Темп выбираете вы.</strong> Сколько слов в день — решать вам, и никакого чувства вины за пропущенный
            день.
          </span>
        </li>
      </ul>
      {goal && (
        <p className={styles.source}>
          По частотному списку NGSL. Сейчас доступно {course.word_count} из {thousands(goal.target_words)} слов — новые
          добавляются.
        </p>
      )}
    </>
  );
}

function DaySummary({ choice, seconds }: { choice: PaceChoice; seconds: number }) {
  return (
    <div className={styles.summary}>
      <p className={styles.summaryWords}>{wordsLabel(choice.words)}</p>
      <p className={styles.summaryLabel}>в день</p>
      <p className={styles.summaryTime}>{formatMinutes(dailyMinutes(choice.words, seconds))}</p>
      <p className={styles.summaryLabel}>в день через месяц, вместе с повторениями</p>
      <p className={styles.summaryDays}>
        {choice.days}&nbsp;дней в неделю
        {choice.ramp && choice.words >= RAMP_MIN_TARGET ? ' · с разогревом' : ''}
      </p>
    </div>
  );
}

type Step = 'promise' | 'pace';
const STEPS: Step[] = ['promise', 'pace'];

export function GoalScreen({ course, me, onDone }: GoalScreenProps) {
  const [step, setStep] = useState<Step>('promise');
  const seconds = DEFAULT_SECONDS_PER_EXERCISE; // a new learner has no answering time to measure yet
  const [choice, setChoice] = useState<PaceChoice>({
    words: me.daily_target_words ?? 5,
    days: me.study_days_per_week,
    ramp: me.ramp_enabled,
  });
  const { run, busy, error } = useAsyncAction();
  const mainRef = useRef<HTMLElement>(null);

  // Each step starts at the top with focus on its heading, like a new page.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
    mainRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, [step]);

  const save = () =>
    run(async () =>
      onDone(
        await api.updateMe({
          daily_target_words: choice.words,
          study_days_per_week: choice.days,
          ramp_enabled: choice.ramp,
        }),
      ),
    );
  const back = step !== 'promise' ? () => setStep(STEPS[STEPS.indexOf(step) - 1]) : undefined;

  return (
    <div className={styles.screen}>
      <header className={styles.topbar}>
        {back ? (
          <button type="button" className={styles.back} onClick={back}>
            <BackIcon aria-hidden="true" /> Назад
          </button>
        ) : (
          <span />
        )}
        <p className={styles.steps}>
          <span className="visually-hidden">
            Шаг {STEPS.indexOf(step) + 1} из {STEPS.length}
          </span>
          {STEPS.map((candidate, index) => (
            <span
              key={candidate}
              aria-hidden="true"
              className={styles.dot}
              data-active={index <= STEPS.indexOf(step)}
            />
          ))}
        </p>
      </header>

      <main ref={mainRef} className={styles.main}>
        <div className={styles.layout} data-step={step}>
          <div className={styles.stage} data-step={step}>
            {step === 'promise' ? (
              <CoverageSentence percent={course.course_goal?.coverage_percent ?? null} />
            ) : (
              <DaySummary choice={choice} seconds={seconds} />
            )}
          </div>
          <div className={styles.content}>
            {step === 'promise' && <CoursePromise course={course} />}
            {step === 'pace' && (
              <>
                <h1 className={styles.heading} tabIndex={-1} data-autofocus>
                  Сколько новых слов в день?
                </h1>
                <p className={styles.lead}>
                  Это план, а не предел: после цели всегда можно взять ещё слов. Если темп окажется слишком быстрым или
                  медленным, приложение подскажет.
                </p>
                <PacePicker value={choice} onChange={setChoice} secondsPerExercise={seconds} />
              </>
            )}
          </div>
        </div>
      </main>

      <footer className={styles.actions}>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.actionsInner}>
          {step !== 'promise' && (
            <p className={styles.footerSummary} aria-hidden="true">
              {wordsLabel(choice.words)} в день · {formatMinutes(dailyMinutes(choice.words, seconds))}
            </p>
          )}
          {step === 'promise' && (
            <PrimaryButton type="button" className={styles.action} onClick={() => setStep('pace')}>
              Выбрать темп
            </PrimaryButton>
          )}
          {step === 'pace' && (
            <PrimaryButton type="button" className={styles.action} disabled={busy} aria-busy={busy} onClick={save}>
              {busy ? 'Сохраняем…' : 'Начать'}
            </PrimaryButton>
          )}
        </div>
      </footer>
    </div>
  );
}
