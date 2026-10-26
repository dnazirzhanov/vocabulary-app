import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import { dailyMinutes, DEFAULT_SECONDS_PER_EXERCISE, formatMinutes, RAMP_MIN_TARGET, wordsLabel } from '../lib/pace.ts';
import type { Deck, Me } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { BackIcon, CheckIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { planInput } from '../plan/planInput.ts';
import { PlanView } from '../plan/PlanView.tsx';
import { CoverageSentence } from './CoverageSentence.tsx';
import { PacePicker, type PaceChoice } from './PacePicker.tsx';
import styles from './GoalScreen.module.css';

interface GoalScreenProps {
  /** First run: the promise, the pace, then the plan. Later ("Моя цель"): pace and plan together. */
  mode: 'onboarding' | 'edit';
  deck: Deck;
  me: Me;
  onDone: (me: Me) => void;
  onBack?: () => void;
}

const thousands = (n: number) => n.toLocaleString('ru-RU');

function CoursePromise({ deck }: { deck: Deck }) {
  const goal = deck.course_goal;
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
            <strong>Вы знаете дату финиша.</strong> Свой темп, понятный план и никакого чувства вины.
          </span>
        </li>
      </ul>
      {goal && (
        <p className={styles.source}>
          По частотному списку NGSL. Сейчас доступно {deck.word_count} из {thousands(goal.target_words)} слов — новые
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

type Step = 'promise' | 'pace' | 'plan';
const STEPS: Step[] = ['promise', 'pace', 'plan'];

export function GoalScreen({ mode, deck: initialDeck, me, onDone, onBack }: GoalScreenProps) {
  const [step, setStep] = useState<Step>(mode === 'onboarding' ? 'promise' : 'pace');
  // "Моя цель" is opened after lessons: fresh counts make the plan start from today's real position.
  const [deck, setDeck] = useState(initialDeck);
  const [today, setToday] = useState({ metToday: 0, seconds: DEFAULT_SECONDS_PER_EXERCISE });
  useEffect(() => {
    if (mode !== 'edit') return;
    void Promise.all([api.listDecks(), api.pace(initialDeck.id)])
      .then(([decks, pace]) => {
        setDeck(decks.find((candidate) => candidate.id === initialDeck.id) ?? initialDeck);
        setToday({ metToday: pace.new_words_today, seconds: pace.seconds_per_exercise });
      })
      .catch(() => undefined); // the plan still works from the counts already loaded
  }, [mode, initialDeck]);
  const seconds = today.seconds;
  const initial: PaceChoice = {
    words: me.daily_target_words ?? 5,
    days: me.study_days_per_week,
    ramp: me.ramp_enabled,
  };
  const [choice, setChoice] = useState<PaceChoice>(initial);
  const { run, busy, error } = useAsyncAction();
  const mainRef = useRef<HTMLElement>(null);

  // Each step starts at the top with focus on its heading, like a new page.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
    mainRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, [step]);

  const unchanged =
    mode === 'edit' && choice.words === initial.words && choice.days === initial.days && choice.ramp === initial.ramp;
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

  const back = mode === 'onboarding' && step !== 'promise' ? () => setStep(STEPS[STEPS.indexOf(step) - 1]) : onBack;
  const plan = (
    <PlanView input={planInput(deck, choice, today.metToday, me.onboarded_at)} deckWords={deck.word_count} />
  );

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
        {mode === 'onboarding' && (
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
        )}
      </header>

      <main ref={mainRef} className={styles.main}>
        <div className={styles.layout} data-step={step}>
          <div className={styles.stage} data-step={step}>
            {step === 'promise' ? (
              <CoverageSentence percent={deck.course_goal?.coverage_percent ?? null} />
            ) : (
              <DaySummary choice={choice} seconds={seconds} />
            )}
          </div>
          <div className={styles.content}>
            {step === 'promise' && <CoursePromise deck={deck} />}
            {step === 'plan' && (
              <>
                <h1 className={styles.heading} tabIndex={-1} data-autofocus>
                  Ваш план
                </h1>
                <p className={styles.lead}>
                  {wordsLabel(choice.words)} в день, {choice.days}&nbsp;дней в неделю. Темп можно поменять в любой
                  момент — план пересчитается.
                </p>
                {plan}
              </>
            )}
            {step === 'pace' && (
              <>
                {mode === 'edit' && deck.course_goal && (
                  <p className={styles.goalLine}>
                    Цель — {thousands(deck.course_goal.target_words)} самых частых слов, около{' '}
                    {deck.course_goal.coverage_percent}% слов в обычных текстах. Сейчас доступно {deck.word_count}.
                  </p>
                )}
                <h1 className={styles.heading} tabIndex={-1} data-autofocus>
                  {mode === 'edit' ? 'Мой темп' : 'Сколько новых слов в день?'}
                </h1>
                <p className={styles.lead}>
                  Это план, а не предел: после цели всегда можно взять ещё слов. Если темп окажется слишком быстрым или
                  медленным, приложение подскажет.
                </p>
                <PacePicker value={choice} onChange={setChoice} secondsPerExercise={seconds} />
                {mode === 'edit' && (
                  <div className={styles.editPlan}>
                    <h2 className={styles.subheading}>План при этом темпе</h2>
                    {plan}
                  </div>
                )}
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
          {step === 'pace' && mode === 'onboarding' && (
            <PrimaryButton type="button" className={styles.action} onClick={() => setStep('plan')}>
              Дальше: мой план
            </PrimaryButton>
          )}
          {(step === 'plan' || mode === 'edit') && (
            <PrimaryButton
              type="button"
              className={styles.action}
              disabled={busy || unchanged}
              aria-busy={busy}
              onClick={save}
            >
              {busy ? 'Сохраняем…' : mode === 'edit' ? 'Сохранить' : 'Начать'}
            </PrimaryButton>
          )}
        </div>
      </footer>
    </div>
  );
}
