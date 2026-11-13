import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, describeError } from '../lib/api.ts';
import { readPhotos } from '../lib/ocr.ts';
import { tokenize } from '../lib/tokens.ts';
import type { ReadingCategory } from '../lib/types.ts';
import { BackIcon, CameraIcon, ForwardIcon, PlusIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { t } from '../i18n/index.ts';
import { loadOwn, TOPICS, TOPIC_NAME, type Topic } from './articles.ts';
import styles from './OwnText.module.css';

/** The server's limit on a text (`MAX_WORDS` in backend/app/services/readings.py). */
const MAX_WORDS = 2000;
/** A photo with less text than this is taken for a miss (the same rule as for decks). */
const MIN_PHOTO_TEXT = 20;
const MAX_PHOTOS = 4;

const wordCount = (text: string) => tokenize(text).filter((part) => part.key).length;

/** A title from the text's first words, when none is given; «…» when the text goes on. */
function titleFrom(text: string) {
  const all = text.trim().split(/\s+/);
  const first = all.slice(0, 6).join(' ');
  if (first.length > 60) return `${first.slice(0, 59).trimEnd()}…`;
  return all.length > 6 ? `${first.replace(/[,.;:!?]+$/, '')}…` : first;
}

/**
 * «Свой текст»: paste the text or photograph the page, choose (or make) its category, «Готово».
 * The text opens at once in the reader; the meanings of its words follow within a minute.
 */
export function OwnText({
  categoryId,
  onBack,
  onSaved,
}: {
  categoryId: string | null;
  onBack: () => void;
  onSaved: (readingId: string) => void;
}) {
  const [categories, setCategories] = useState<ReadingCategory[]>([]);
  const [category, setCategory] = useState<string | null>(categoryId);
  // Or one of the library's topics (science, history…): the text shows inside it. One or the other.
  const [topic, setTopic] = useState<Topic | null>(null);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const pickCategory = (id: string | null) => (setCategory(id), setTopic(null));
  const pickTopic = (one: Topic) => (setTopic(one), setCategory(null));
  const [naming, setNaming] = useState(false);
  const [newName, setNewName] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadOwn().then(
      (own) => setCategories(own.categories),
      () => undefined,
    );
  }, []);

  const words = wordCount(text);
  const tooLong = words > MAX_WORDS;

  const addCategory = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const made = await api.addReadingCategory(name);
      setCategories((before) => [...before, made]);
      pickCategory(made.id);
      setNaming(false);
      setNewName('');
      setProblem(null);
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const addPhotos = async (chosen: File[]) => {
    const files = chosen.slice(0, MAX_PHOTOS);
    if (files.length === 0) return;
    setNote(null);
    setProblem(null);
    setReading({ done: 0, total: files.length });
    try {
      const texts = await readPhotos(files, (done) => setReading({ done, total: files.length }));
      const read = texts.filter((part) => part.length >= MIN_PHOTO_TEXT);
      if (read.length < texts.length) setNote(read.length === 0 ? t.thereSAlmostNoTextIn : t.oneOfThePhotosHasAlmost);
      if (read.length > 0) setText((before) => [before.trim(), ...read].filter(Boolean).join('\n\n'));
    } catch {
      setProblem(t.couldnTReadThePhotoCheck);
    } finally {
      setReading(null);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (words === 0 || tooLong || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const made = await api.addReading(title.trim() || titleFrom(text), text, category, topic);
      onSaved(made.id);
    } catch (error) {
      setProblem(describeError(error));
      setBusy(false);
    }
  };

  return (
    <div className={styles.screen}>
      <header className={styles.topbar}>
        <button type="button" className={styles.back} onClick={onBack}>
          <BackIcon aria-hidden="true" /> {t.reading}
        </button>
      </header>
      <main className={styles.main}>
        <form className={styles.column} onSubmit={(event) => void save(event)}>
          <h1 className={styles.title}>{t.ownText}</h1>

          <label className={styles.field}>
            <span>{t.englishText}</span>
            <textarea
              value={text}
              rows={10}
              placeholder={t.pasteOrPhotograph}
              aria-invalid={tooLong}
              aria-describedby="own-text-count"
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <div className={styles.under}>
            <button
              type="button"
              className={styles.outline}
              disabled={reading !== null}
              onClick={() => fileInput.current?.click()}
            >
              <CameraIcon aria-hidden="true" /> {t.photographPage}
            </button>
            <span id="own-text-count" className={tooLong ? styles.over : styles.count}>
              {t.wordsOfMax(words, MAX_WORDS)}
            </span>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            aria-label={t.photosOfPages}
            onChange={(event) => {
              const chosen = Array.from(event.target.files ?? []);
              event.target.value = ''; // the same photo can be chosen again
              void addPhotos(chosen);
            }}
          />
          <div role="status">
            {reading && (
              <>
                <p className={styles.note}>
                  {t.readingPhotoOf(Math.min(reading.total, Math.floor(reading.done) + 1), reading.total)}
                </p>
                <progress max={reading.total} value={reading.done} aria-label={t.readingThePhotos} />
              </>
            )}
            {note && <p className={styles.note}>{note}</p>}
            {tooLong && <p className={styles.note}>{t.readingTooLong}</p>}
          </div>

          <label className={styles.field}>
            <span>
              {t.textTitle} <span className={styles.optional}>{t.optional}</span>
            </span>
            <input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />
          </label>

          <fieldset className={styles.categories}>
            <legend>{t.category}</legend>
            <div className={styles.chips}>
              {[{ id: null, name: t.noCategory }, ...categories].map((one) => (
                <button
                  key={one.id ?? 'none'}
                  type="button"
                  aria-pressed={topic === null && category === one.id}
                  onClick={() => pickCategory(one.id)}
                >
                  {one.name}
                </button>
              ))}
              {!naming && (
                <button type="button" className={styles.newChip} onClick={() => setNaming(true)}>
                  <PlusIcon aria-hidden="true" /> {t.newCategory}
                </button>
              )}
            </div>
            {naming && (
              <div className={styles.naming}>
                <input
                  autoFocus
                  value={newName}
                  maxLength={40}
                  aria-label={t.categoryName}
                  placeholder={t.categoryName}
                  onChange={(event) => setNewName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void addCategory();
                    }
                  }}
                />
                <button
                  type="button"
                  className={styles.outline}
                  disabled={!newName.trim()}
                  onClick={() => void addCategory()}
                >
                  {t.create}
                </button>
              </div>
            )}
            {/* The library's topics, folded away until wanted: a text of mine can live in one. */}
            <button
              type="button"
              className={styles.topicsToggle}
              aria-expanded={topicsOpen || topic !== null}
              aria-controls="own-text-topics"
              onClick={() => setTopicsOpen(!(topicsOpen || topic !== null))}
            >
              <ForwardIcon aria-hidden="true" /> {t.libraryTopics}
              {topic && <span className={styles.picked}>· {TOPIC_NAME[topic]()}</span>}
            </button>
            {(topicsOpen || topic !== null) && (
              <div id="own-text-topics" className={styles.chips}>
                {TOPICS.map((one) => (
                  <button key={one} type="button" aria-pressed={topic === one} onClick={() => pickTopic(one)}>
                    {TOPIC_NAME[one]()}
                  </button>
                ))}
              </div>
            )}
          </fieldset>

          {problem && (
            <p className={styles.problem} role="alert">
              {problem}
            </p>
          )}
          <PrimaryButton type="submit" disabled={words === 0 || tooLong || busy || reading !== null}>
            {t.readingDone}
          </PrimaryButton>
        </form>
      </main>
    </div>
  );
}
