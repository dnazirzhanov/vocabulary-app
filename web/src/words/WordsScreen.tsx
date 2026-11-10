import type { CardLanguage } from '../i18n/languages.ts';
import { deckCards } from '../local/myDecks.ts';
import { localDb, withSnapshot } from '../local/session.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { foldText } from '../i18n/fold.ts';
import { api, describeError } from '../lib/api.ts';
import { partOfSpeech } from '../lib/partOfSpeech.ts';
import { relativeDay } from '../lib/relativeDay.ts';
import { playAudio } from '../lib/audio.ts';
import type { DeckWord, WordStatus } from '../lib/types.ts';
import { BackIcon, FlagIcon, PencilIcon, SpeakerIcon } from '../ui/icons.tsx';
import { CardMenu } from '../lesson/CardMenu.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './WordsScreen.module.css';
import { t } from '../i18n/index.ts';

const STATUS_LABEL: Record<WordStatus, string> = {
  not_started: t.aheadCapital,
  new: t.newWord,
  learning: t.learningNow,
  well_learned: t.rememberedCapital,
};
const FILTERS: (WordStatus | 'all')[] = ['all', 'not_started', 'new', 'learning', 'well_learned'];

// Search ignores case and ё/е, so "еще" finds "ещё".
const normalize = (text: string) => foldText(text).trim();

interface WordsScreenProps {
  deckId: string;
  deckTitle: string;
  onBack: () => void;
  /** My own deck: its editor (ADR 0051). */
  onEdit?: () => void;
}

/** Every word of the deck, met or not, with where the learner stands on each. */
export function WordsScreen({ deckId, deckTitle, onBack, onEdit }: WordsScreenProps) {
  const [words, setWords] = useState<DeckWord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<WordStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [reporting, setReporting] = useState<{ id: string; headword: string } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Without a connection: the list as last seen, or my deck's cards on this device (ADR 0060, 0061).
  const load = () => wordsOf(deckId).then(setWords, (caught: unknown) => setError(describeError(caught)));
  useEffect(() => {
    void wordsOf(deckId).then(setWords, (caught: unknown) => setError(describeError(caught)));
  }, [deckId]);
  useEffect(() => headingRef.current?.focus(), []);

  const counts = useMemo(() => {
    const result: Record<WordStatus | 'all', number> = { all: 0, not_started: 0, new: 0, learning: 0, well_learned: 0 };
    for (const row of words ?? []) {
      result.all += 1;
      result[row.status] += 1;
    }
    return result;
  }, [words]);
  const shown = useMemo(() => {
    const needle = normalize(query);
    return (words ?? []).filter(
      (row) =>
        (filter === 'all' || row.status === filter) &&
        (!needle || normalize(row.word.headword).includes(needle) || normalize(row.word.translation).includes(needle)),
    );
  }, [words, filter, query]);

  return (
    <div className={styles.screen}>
      <header className={styles.topbar}>
        <button type="button" className={styles.back} onClick={onBack}>
          <BackIcon aria-hidden="true" /> {t.back}
        </button>
      </header>
      <main className={styles.main}>
        <div className={styles.column}>
          <p className={styles.eyebrow}>{deckTitle}</p>
          <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
            {t.deckWords}
          </h1>
          {onEdit && (
            <button type="button" className={styles.edit} onClick={onEdit}>
              <PencilIcon aria-hidden="true" /> {t.editTheDeck}
            </button>
          )}

          {error && (
            <div className={styles.message}>
              <p role="alert">{error}</p>
              <PrimaryButton
                type="button"
                onClick={() => {
                  setError(null);
                  void load();
                }}
              >
                {t.tryAgain}
              </PrimaryButton>
            </div>
          )}
          {!error && !words && (
            <p className={styles.message} aria-busy="true">
              {t.loading}
            </p>
          )}
          {words && (
            <>
              <div className={styles.tools}>
                <label className={styles.search}>
                  <span className="visually-hidden">{t.findAWord}</span>
                  <input
                    type="search"
                    placeholder={t.searchHouseOr}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    maxLength={64}
                  />
                </label>
                <div className={styles.filters} role="group" aria-label={t.show}>
                  {FILTERS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={styles.filter}
                      aria-pressed={filter === option}
                      onClick={() => setFilter(option)}
                    >
                      {option === 'all' ? t.all : STATUS_LABEL[option]}
                      <span className={styles.count}>{counts[option]}</span>
                    </button>
                  ))}
                </div>
              </div>

              <p className={styles.resultCount} role="status">
                {shown.length === 0 ? t.nothingFound : t.wordsCount(shown.length)}
              </p>
              <ol className={styles.list}>
                {shown.map((row) => (
                  <WordRow key={row.word.id} row={row} onReport={() => setReporting(row.word)} />
                ))}
              </ol>
            </>
          )}
        </div>
      </main>
      {reporting && <CardMenu deckId={deckId} word={reporting} withSpeed={false} onClose={() => setReporting(null)} />}
    </div>
  );
}

function WordRow({ row, onReport }: { row: DeckWord; onReport: () => void }) {
  const { word, status } = row;
  const pos = partOfSpeech(word.pos);
  return (
    <li className={styles.row}>
      <div className={styles.rowHead}>
        <span className={styles.number} aria-hidden="true">
          {row.position + 1}
        </span>
        <div className={styles.words}>
          <p className={styles.headword}>
            <span lang="en">{word.headword}</span>{' '}
            <abbr className={styles.pos} title={pos.full}>
              {pos.short}
            </abbr>
          </p>
          <p className={styles.translation}>{word.translation}</p>
        </div>
        <button
          type="button"
          className={styles.listen}
          onClick={() => void playAudio('words', word.id, word.headword)}
          aria-label={t.listen(word.headword)}
        >
          <SpeakerIcon />
        </button>
        <button
          type="button"
          className={styles.report}
          onClick={onReport}
          aria-label={t.reportWord(word.headword)}
          aria-haspopup="dialog"
        >
          <FlagIcon />
        </button>
      </div>
      <div className={styles.meta}>
        <span className={styles.status} data-status={status}>
          {STATUS_LABEL[status]}
        </span>
        {row.next_review_at && status !== 'not_started' && (
          <span className={styles.next}>
            {t.reviewLower} {relativeDay(row.next_review_at)}
          </span>
        )}
      </div>
      <details className={styles.example}>
        <summary>{t.example}</summary>
        <p lang="en">{word.example}</p>
        <p className={styles.exampleRu}>{word.example_translation}</p>
      </details>
    </li>
  );
}

export async function wordsOf(deckId: string): Promise<DeckWord[]> {
  try {
    return (await withSnapshot(`deckWords:${deckId}`, () => api.deckWords(deckId))).value;
  } catch (error) {
    const db = localDb();
    const cards = db ? await deckCards(db, deckId) : [];
    if (cards.length === 0) throw error;
    // Never seen online: every card as not started yet.
    return cards.map((card, index) => ({
      position: index,
      word: {
        id: card.id,
        headword: card.headword,
        pos: card.pos,
        translation: card.translation,
        example: card.example,
        example_translation: card.example_translation,
        language: card.language as CardLanguage,
        illustration: null,
      },
      status: 'not_started',
      next_review_at: null,
    }));
  }
}
