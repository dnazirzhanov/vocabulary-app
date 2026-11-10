import { useEffect, useState } from 'react';
import { api, describeError } from '../lib/api.ts';
import type { ReportedCard } from '../lib/types.ts';
import { Dialog } from '../ui/Dialog.tsx';
import styles from './Reports.module.css';
import { t } from '../i18n/index.ts';

/**
 * Cards learners said are wrong, for whoever corrects them: the owner (the course's cards) or a
 * deck's author (its own cards). «Исправлено» closes a card's reports; editing the card does too.
 */
export function ReportsDialog({
  load,
  onClose,
}: {
  load: () => Promise<{ cards: ReportedCard[] }>;
  onClose: () => void;
}) {
  const [cards, setCards] = useState<ReportedCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    load().then(
      (sent) => setCards(sent.cards),
      (caught: unknown) => setError(describeError(caught)),
    );
  }, [load]);
  const done = async (wordId: string) => {
    try {
      await api.resolveReports(wordId);
      setCards((now) => now?.filter((card) => card.word_id !== wordId) ?? null);
    } catch (caught) {
      setError(describeError(caught));
    }
  };
  return (
    <Dialog open onClose={onClose} title={t.cardReports}>
      {error && <p role="alert">{error}</p>}
      {cards === null && !error && <p>{t.loading}</p>}
      {cards?.length === 0 && <p className={styles.muted}>{t.noReports}</p>}
      <ul className={styles.list}>
        {cards?.map((card) => (
          <li key={card.word_id} className={styles.card}>
            <p className={styles.word}>
              <strong lang="en">{card.headword}</strong> — {card.translation}
            </p>
            <p className={styles.example} lang="en">
              {card.example}
            </p>
            <p className={styles.muted}>{t.reportedTimes(card.translation_wrong, card.example_wrong, card.other)}</p>
            {card.notes.map((note, index) => (
              <q key={index} className={styles.note}>
                {note}
              </q>
            ))}
            <button type="button" className={styles.done} onClick={() => void done(card.word_id)}>
              {t.markDone}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
