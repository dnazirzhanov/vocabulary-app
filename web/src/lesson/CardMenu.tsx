import { useState } from 'react';
import { exampleSpeed, setExampleSpeed, type Speed } from '../lib/audio.ts';
import type { CardReport } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { study } from '../study/device.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './CardMenu.module.css';
import { t } from '../i18n/index.ts';

const REASONS: { reason: CardReport['reason']; label: () => string }[] = [
  { reason: 'translation', label: () => t.wrongTranslation },
  { reason: 'example', label: () => t.wrongExample },
  { reason: 'other', label: () => t.somethingElse },
];

/**
 * A card's «⋯»: how fast its example is read (in a lesson), and «Сообщить об ошибке» — sent with
 * the other changes, so it works offline. The same sheet serves the deck's word list.
 */
export function CardMenu({
  deckId,
  word,
  withSpeed,
  onClose,
}: {
  deckId: string;
  word: { id: string; headword: string };
  withSpeed: boolean;
  onClose: () => void;
}) {
  const [speed, setSpeed] = useState<Speed>(exampleSpeed);
  const [reason, setReason] = useState<CardReport['reason']>('translation');
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const { run, busy, error } = useAsyncAction();
  const choose = (next: Speed) => (setExampleSpeed(next), setSpeed(next));

  return (
    <Dialog open onClose={onClose} title={word.headword}>
      {withSpeed && (
        <section className={styles.section} aria-label={t.exampleSpeed}>
          <h3 className={styles.heading}>{t.exampleSpeed}</h3>
          <div className={styles.chips} role="group" aria-label={t.exampleSpeed}>
            <button type="button" aria-pressed={speed === 'normal'} onClick={() => choose('normal')}>
              {t.normalSpeed}
            </button>
            <button type="button" aria-pressed={speed === 'slow'} onClick={() => choose('slow')}>
              {t.slowSpeed}
            </button>
          </div>
        </section>
      )}
      <section className={styles.section} aria-label={t.reportAMistake}>
        <h3 className={styles.heading}>{t.reportAMistake}</h3>
        {sent ? (
          <p className={styles.thanks} role="status">
            {t.thanksReported}
          </p>
        ) : (
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              run(async () => {
                await study.reportCard({ deck_id: deckId, word_id: word.id, reason, note: note.trim() || undefined });
                setSent(true);
              });
            }}
          >
            <div className={styles.reasons} role="radiogroup" aria-label={t.reportAMistake}>
              {REASONS.map((item) => (
                <button
                  key={item.reason}
                  type="button"
                  role="radio"
                  aria-checked={reason === item.reason}
                  onClick={() => setReason(item.reason)}
                >
                  {item.label()}
                </button>
              ))}
            </div>
            <textarea
              className={styles.note}
              aria-label={t.whatIsWrongOptional}
              placeholder={t.whatIsWrongOptional}
              maxLength={300}
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <PrimaryButton type="submit" disabled={busy} aria-busy={busy}>
              {busy ? t.loading : t.send}
            </PrimaryButton>
          </form>
        )}
      </section>
    </Dialog>
  );
}
