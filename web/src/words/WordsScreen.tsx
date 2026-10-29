import { useEffect, useMemo, useRef, useState } from 'react';
import { plural } from '../i18n/plural.ts';
import { api, describeError } from '../lib/api.ts';
import { partOfSpeech } from '../lib/partOfSpeech.ts';
import { relativeDay } from '../lib/relativeDay.ts';
import { playAudio } from '../lib/audio.ts';
import type { DeckWord, WordStatus } from '../lib/types.ts';
import { BackIcon, SpeakerIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './WordsScreen.module.css';

const STATUS_LABEL: Record<WordStatus, string> = {
  not_started: 'Впереди',
  new: 'Новое',
  learning: 'Учу',
  well_learned: 'Помню хорошо',
};
const FILTERS: (WordStatus | 'all')[] = ['all', 'not_started', 'new', 'learning', 'well_learned'];

// Search ignores case and ё/е, so "еще" finds "ещё".
const normalize = (text: string) => text.toLowerCase().replaceAll('ё', 'е').trim();

interface WordsScreenProps {
  deckId: string;
  deckTitle: string;
  onBack: () => void;
}

/** Every word of the deck, met or not, with where the learner stands on each. */
export function WordsScreen({ deckId, deckTitle, onBack }: WordsScreenProps) {
  const [words, setWords] = useState<DeckWord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<WordStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = () => api.deckWords(deckId).then(setWords, (caught: unknown) => setError(describeError(caught)));
  useEffect(() => {
    void api.deckWords(deckId).then(setWords, (caught: unknown) => setError(describeError(caught)));
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
          <BackIcon aria-hidden="true" /> На главную
        </button>
      </header>
      <main className={styles.main}>
        <div className={styles.column}>
          <p className={styles.eyebrow}>{deckTitle}</p>
          <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
            Слова колоды
          </h1>

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
                Повторить
              </PrimaryButton>
            </div>
          )}
          {!error && !words && (
            <p className={styles.message} aria-busy="true">
              Загружаем…
            </p>
          )}
          {words && (
            <>
              <div className={styles.tools}>
                <label className={styles.search}>
                  <span className="visually-hidden">Найти слово</span>
                  <input
                    type="search"
                    placeholder="Поиск: house или дом"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    maxLength={64}
                  />
                </label>
                <div className={styles.filters} role="group" aria-label="Показать">
                  {FILTERS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={styles.filter}
                      aria-pressed={filter === option}
                      onClick={() => setFilter(option)}
                    >
                      {option === 'all' ? 'Все' : STATUS_LABEL[option]}
                      <span className={styles.count}>{counts[option]}</span>
                    </button>
                  ))}
                </div>
              </div>

              <p className={styles.resultCount} role="status">
                {shown.length === 0
                  ? 'Ничего не нашлось.'
                  : `${shown.length}\u00a0${plural(shown.length, { one: 'слово', few: 'слова', many: 'слов' })}`}
              </p>
              <ol className={styles.list}>
                {shown.map((row) => (
                  <WordRow key={row.word.id} row={row} />
                ))}
              </ol>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function WordRow({ row }: { row: DeckWord }) {
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
          aria-label={`Послушать: ${word.headword}`}
        >
          <SpeakerIcon />
        </button>
      </div>
      <div className={styles.meta}>
        <span className={styles.status} data-status={status}>
          {STATUS_LABEL[status]}
        </span>
        {row.next_review_at && status !== 'not_started' && (
          <span className={styles.next}>повтор {relativeDay(row.next_review_at)}</span>
        )}
      </div>
      <details className={styles.example}>
        <summary>Пример</summary>
        <p lang="en">{word.example}</p>
        <p className={styles.exampleRu}>{word.example_ru}</p>
      </details>
    </li>
  );
}
