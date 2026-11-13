import { useEffect, useState } from 'react';
import { api, describeError } from '../lib/api.ts';
import type { GivenQuestion, OwnReading } from '../lib/types.ts';
import { BackIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { t } from '../i18n/index.ts';
import { editable, QuestionsEditor, sound } from './QuestionsEditor.tsx';
import styles from './GiveReading.module.css';

/**
 * «Изменить вопросы» for a text of my own (round 2): the AI's draft changed, questions dropped,
 * mine added — with options, true or false, or open. A question kept keeps its answers.
 */
export function EditQuestions({ readingId, onDone }: { readingId: string; onDone: () => void }) {
  const [reading, setReading] = useState<OwnReading | null>(null);
  const [questions, setQuestions] = useState<GivenQuestion[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    api.reading(readingId).then(
      (loaded) => {
        if (!live) return;
        setReading(loaded);
        setQuestions(editable(loaded.questions));
      },
      (error: unknown) => live && setProblem(describeError(error)),
    );
    return () => {
      live = false;
    };
  }, [readingId]);

  const save = async () => {
    if (!questions.every(sound)) return setProblem(t.questionsNeedFixing);
    setBusy(true);
    setProblem(null);
    try {
      await api.setReadingQuestions(
        readingId,
        questions.map((one) => ({ ...one, q: one.q.trim(), options: one.options?.map((option) => option.trim()) })),
      );
      onDone();
    } catch (error) {
      setProblem(describeError(error));
      setBusy(false);
    }
  };

  return (
    <div className={styles.screen}>
      <header className={styles.topbar}>
        <button type="button" className={styles.back} onClick={onDone}>
          <BackIcon aria-hidden="true" /> {t.backToText}
        </button>
      </header>
      <main className={styles.main}>
        <div className={styles.column}>
          <h1 className={styles.title}>{t.editQuestions}</h1>
          {reading && (
            <p className={styles.subtitle} lang="en">
              {reading.title}
            </p>
          )}
          {reading && <QuestionsEditor questions={questions} onChange={setQuestions} />}
          {problem && (
            <p className={styles.problem} role="alert">
              {problem}
            </p>
          )}
          {reading && (
            <PrimaryButton type="button" disabled={busy} onClick={() => void save()}>
              {t.save}
            </PrimaryButton>
          )}
        </div>
      </main>
    </div>
  );
}
