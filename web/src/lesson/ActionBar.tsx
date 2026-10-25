import type { Ref } from 'react';
import { CheckIcon, CrossIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './ActionBar.module.css';

export interface ActionBarFeedback {
  correct: boolean;
  word: string;
  answer: string;
}

interface ActionBarProps {
  canCheck: boolean;
  feedback?: ActionBarFeedback;
  onContinue: () => void;
  continueRef: Ref<HTMLButtonElement>;
}

/** Bottom action area. The primary button never moves; feedback appears beside or above it. */
export function ActionBar({ canCheck, feedback, onContinue, continueRef }: ActionBarProps) {
  const tone = feedback ? (feedback.correct ? 'success' : 'error') : 'neutral';
  return (
    <footer className={styles.bar} data-tone={tone}>
      <div className={styles.inner}>
        <div className={styles.message} role="status">
          {feedback && (
            <div className={styles.feedback}>
              <span className={styles.icon} aria-hidden="true">
                {feedback.correct ? <CheckIcon /> : <CrossIcon />}
              </span>
              <div>
                <p className={styles.title}>{feedback.correct ? 'Верно!' : 'Не совсем'}</p>
                <p className={styles.detail}>
                  {feedback.correct ? (
                    <>
                      <span lang="en">{feedback.word}</span> — {feedback.answer}
                    </>
                  ) : (
                    <>
                      Правильный ответ: <strong>{feedback.answer}</strong>
                    </>
                  )}
                </p>
              </div>
            </div>
          )}
        </div>
        {feedback ? (
          <PrimaryButton type="button" className={styles.action} onClick={onContinue} ref={continueRef}>
            Продолжить
          </PrimaryButton>
        ) : (
          <PrimaryButton type="submit" className={styles.action} disabled={!canCheck}>
            Проверить
          </PrimaryButton>
        )}
      </div>
    </footer>
  );
}
