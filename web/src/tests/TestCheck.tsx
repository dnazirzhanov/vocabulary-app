import { useEffect, useRef, useState } from 'react';
import type { TestWordState } from '../lib/types.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { BackIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import shared from '../groups/Groups.module.css';
import styles from './Tests.module.css';
import { t } from '../i18n/index.ts';

interface TestCheckProps {
  /** Every word as this device knows it, answers given here included. */
  words: TestWordState[];
  busy: boolean;
  /** Back to one word, to answer or change it. */
  onOpen: (index: number) => void;
  /** Back to the last word. */
  onBack: () => void;
  onHandIn: () => void;
}

/**
 * Before handing in (ADR 0069): every word by its meaning, done or still empty, each a way back to
 * it. «Сдать» hands in at once when everything has an answer, and asks first when something is empty.
 */
export function TestCheck({ words, busy, onOpen, onBack, onHandIn }: TestCheckProps) {
  const [asking, setAsking] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const empty = words.filter((word) => word.state !== 'answered').length;
  const label = { answered: t.testStateAnswered, skipped: t.skipped, empty: t.testStateEmpty };

  return (
    <section className={styles.check} aria-labelledby="test-check">
      <h1 id="test-check" ref={headingRef} tabIndex={-1} className={styles.checkTitle}>
        {t.testCheckTitle}
      </h1>
      <p className={shared.note}>{empty ? t.testCheckEmpty(empty) : t.testCheckAllDone}</p>
      <ol className={styles.checkList} aria-label={t.testCheckTitle}>
        {words.map((word, index) => (
          <li key={index}>
            <button
              type="button"
              className={styles.checkRow}
              data-state={word.state}
              disabled={busy}
              onClick={() => onOpen(index)}
            >
              <span className={styles.checkNumber} aria-hidden="true">
                {index + 1}
              </span>
              <span className={styles.checkMeaning}>{word.translation}</span>
              <span className={styles.checkState}>{label[word.state]}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className={styles.checkActions}>
        <button type="button" className={styles.checkBack} disabled={busy} onClick={onBack}>
          <BackIcon aria-hidden="true" />
          {t.back}
        </button>
        <PrimaryButton
          type="button"
          className={styles.checkHandIn}
          disabled={busy}
          aria-busy={busy}
          onClick={() => (empty ? setAsking(true) : onHandIn())}
        >
          {t.handIn}
        </PrimaryButton>
      </div>
      <Dialog open={asking} onClose={() => setAsking(false)} title={t.handInWithEmptyQuestion}>
        <div className={styles.setup}>
          <p>{t.handInWithEmptyText(empty)}</p>
          <PrimaryButton
            type="button"
            onClick={() => {
              setAsking(false);
              onHandIn();
            }}
          >
            {t.handIn}
          </PrimaryButton>
          <button type="button" className={shared.linkButton} data-autofocus onClick={() => setAsking(false)}>
            {t.backToTheWords}
          </button>
        </div>
      </Dialog>
    </section>
  );
}
