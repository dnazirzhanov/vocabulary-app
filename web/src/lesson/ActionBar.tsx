import type { ReactNode, Ref } from 'react';
import { AlertIcon, CheckIcon, CrossIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './ActionBar.module.css';

export type ActionBarState =
  | { kind: 'submit'; label: string; busyLabel: string; disabled: boolean; busy: boolean }
  | { kind: 'feedback'; correct: boolean; detail: ReactNode; busy: boolean; onContinue: () => void }
  // A failed request, not a wrong answer: neutral styling, and the learner's answer is kept.
  | { kind: 'problem'; message: string; onRetry: () => void };

interface ActionBarProps {
  state: ActionBarState;
  buttonRef: Ref<HTMLButtonElement>;
}

/** Bottom action area. The primary button never moves; messages appear beside or above it. */
export function ActionBar({ state, buttonRef }: ActionBarProps) {
  const tone = state.kind === 'feedback' ? (state.correct ? 'success' : 'error') : state.kind;
  return (
    <footer className={styles.bar} data-tone={tone}>
      <div className={styles.inner}>
        <div className={styles.message} role="status">
          {state.kind === 'feedback' && (
            <div className={styles.feedback}>
              <span className={styles.icon} aria-hidden="true">
                {state.correct ? <CheckIcon /> : <CrossIcon />}
              </span>
              <div>
                <p className={styles.title}>{state.correct ? 'Верно!' : 'Не совсем'}</p>
                <p className={styles.detail}>{state.detail}</p>
              </div>
            </div>
          )}
          {state.kind === 'problem' && (
            <div className={styles.feedback}>
              <span className={styles.icon} aria-hidden="true">
                <AlertIcon />
              </span>
              <p className={styles.detail}>{state.message}</p>
            </div>
          )}
        </div>
        {/* Distinct keys give each state its own <button>. Reusing one element would turn the
            Continue button into a submit button mid-click, and the browser would then submit
            the next exercise with that same click. */}
        {state.kind === 'submit' && (
          <PrimaryButton
            key="submit"
            type="submit"
            className={styles.action}
            disabled={state.disabled || state.busy}
            aria-busy={state.busy}
            ref={buttonRef}
          >
            {state.busy ? state.busyLabel : state.label}
          </PrimaryButton>
        )}
        {state.kind === 'feedback' && (
          <PrimaryButton
            key="continue"
            type="button"
            className={styles.action}
            onClick={state.onContinue}
            disabled={state.busy}
            aria-busy={state.busy}
            ref={buttonRef}
          >
            {state.busy ? 'Сохраняем…' : 'Продолжить'}
          </PrimaryButton>
        )}
        {state.kind === 'problem' && (
          <PrimaryButton key="retry" type="button" className={styles.action} onClick={state.onRetry} ref={buttonRef}>
            Повторить
          </PrimaryButton>
        )}
      </div>
    </footer>
  );
}
