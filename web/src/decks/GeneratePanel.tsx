import type { CardLanguage } from '../i18n/languages.ts';
import { TranslationLanguage } from './TranslationLanguage.tsx';
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { api, describeError } from '../lib/api.ts';
import { readPhotos } from '../lib/ocr.ts';
import { wordsLabel } from '../lib/pace.ts';
import { MAX_PHOTOS_PER_DECK, MAX_PHOTOS_PER_DRAFT, MIN_PHOTO_TEXT, takePhotos } from '../lib/photos.ts';
import type { GenerateResult } from '../lib/types.ts';
import { CameraIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './DeckEditor.module.css';
import { DraftResult } from './DraftResult.tsx';
import { t } from '../i18n/index.ts';

const COUNTS = [5, 10, 20, 30, 50];
const MAX_COUNT = 50;
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];
const MAX_TEXT = 20_000;

/**
 * The teacher's lesson material in, a draft of cards out (ADR 0018): the cards land in the deck
 * above for review; nothing reaches the students until the deck is given. The material is typed,
 * pasted, or read from photos in the browser (ADR 0029: up to 4 at a time, 8 per deck); the text
 * shows for a fix before drafting, and none of it is kept.
 */
export function GeneratePanel({
  deckId,
  language,
  onLanguage,
  photosLeft,
  onDrafted,
}: {
  deckId: string;
  language: CardLanguage;
  onLanguage: (language: CardLanguage) => void;
  /** Photos the deck can still take (of 8). */
  photosLeft: number;
  onDrafted: (result: GenerateResult) => void;
}) {
  const [text, setText] = useState('');
  const [count, setCount] = useState(10);
  const [level, setLevel] = useState('B1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<GenerateResult | null>(null);
  // Photos read into this draft, by name; how far reading has got while it runs.
  const [photos, setPhotos] = useState<string[]>([]);
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  // A file is being dragged over the panel: it shows where to drop it.
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const ready = text.trim().length >= 20;
  const working = busy || reading !== null;
  const room = Math.min(MAX_PHOTOS_PER_DRAFT - photos.length, photosLeft - photos.length);

  const addPhotos = async (chosen: File[]) => {
    const { take, note } = takePhotos(chosen.length, photos.length, photosLeft);
    setPhotoNote(note);
    setError(null);
    if (take === 0) return;
    const files = chosen.slice(0, take);
    setReading({ done: 0, total: files.length });
    try {
      const texts = await readPhotos(files, (done) => setReading({ done, total: files.length }));
      const read = texts.filter((part) => part.length >= MIN_PHOTO_TEXT);
      if (read.length < texts.length)
        setPhotoNote(read.length === 0 ? t.thereSAlmostNoTextIn : t.oneOfThePhotosHasAlmost);
      if (read.length > 0) {
        setText((before) => [before.trim(), ...read].filter(Boolean).join('\n\n').slice(0, MAX_TEXT));
        setPhotos((before) => [
          ...before,
          ...files.filter((_, index) => texts[index].length >= MIN_PHOTO_TEXT).map((file) => file.name),
        ]);
      }
    } catch {
      setError(t.couldnTReadThePhotoCheck);
    } finally {
      setReading(null);
    }
  };

  /** Images dropped or pasted: screenshots straight from the desktop or the clipboard. */
  const addImages = (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith('image/'));
    if (images.length === 0) {
      setPhotoNote(t.thatIsnTAPictureDrag);
      return;
    }
    if (!working) void addPhotos(images);
  };
  const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');
  // A file dropped just outside the panel would make the browser open it and leave the app.
  useEffect(() => {
    const keep = (event: globalThis.DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    };
    window.addEventListener('dragover', keep);
    window.addEventListener('drop', keep);
    return () => {
      window.removeEventListener('dragover', keep);
      window.removeEventListener('drop', keep);
    };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (working || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.generateDeck(deckId, text.trim(), count, level, language, photos.length);
      setLast(result);
      setPhotos([]);
      setPhotoNote(null);
      onDrafted(result);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className={styles.paneForm}
      onSubmit={(event) => void submit(event)}
      aria-labelledby="tab-text"
      data-dragging={dragging || undefined}
      onDragEnter={(event) => carriesFiles(event) && (event.preventDefault(), setDragging(true))}
      onDragOver={(event) => carriesFiles(event) && event.preventDefault()}
      onDragLeave={(event) => {
        // Leaving for a child is still inside the panel.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setDragging(false);
        addImages(Array.from(event.dataTransfer.files));
      }}
    >
      {dragging && (
        <div className={styles.dropHint} aria-hidden="true">
          <CameraIcon /> {t.letGoAndWeLlRead}
        </div>
      )}
      <p className={styles.note}>{t.pasteATextAnExerciseOr}</p>
      <label className={styles.field}>
        <span className="visually-hidden">{t.lessonText}</span>
        <textarea
          lang="en"
          rows={7}
          maxLength={MAX_TEXT}
          placeholder="After several setbacks, the company managed to carry out the experiment…"
          value={text}
          disabled={working}
          onChange={(event) => setText(event.target.value)}
          onPaste={(event) => {
            // A screenshot in the clipboard is read like a photo; pasted text goes in as usual.
            const files = Array.from(event.clipboardData.files);
            if (files.some((file) => file.type.startsWith('image/'))) {
              event.preventDefault();
              addImages(files);
            }
          }}
        />
      </label>

      <div className={styles.photos}>
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
        <button
          type="button"
          className={styles.outlineButton}
          disabled={working || room <= 0}
          onClick={() => fileInput.current?.click()}
          aria-describedby="photos-note"
        >
          <CameraIcon aria-hidden="true" /> {t.addAPhoto}
        </button>
        <p id="photos-note" className={styles.note}>
          {photosLeft <= 0
            ? t.photosHaveAlreadyBeenAddedTo(MAX_PHOTOS_PER_DECK)
            : t.upToAtATimeOf(MAX_PHOTOS_PER_DRAFT, photosLeft - photos.length, MAX_PHOTOS_PER_DECK)}
          {photosLeft > 0 && <span className={styles.desktopOnly}> {t.youCanDragAScreenshotHere}</span>}
        </p>
      </div>
      <div role="status" className={styles.generateStatus}>
        {reading && (
          <>
            <p className={styles.note}>
              {t.readingPhotoOf(Math.min(reading.total, Math.floor(reading.done) + 1), reading.total)}
            </p>
            <progress
              className={styles.reading}
              max={reading.total}
              value={reading.done}
              aria-label={t.readingThePhotos}
            />
          </>
        )}
        {!reading && photos.length > 0 && <p className={styles.note}>{t.textFromPhotos(photos.length)}</p>}
        {!reading && photoNote && <p className={styles.problem}>{photoNote}</p>}
      </div>

      <div className={styles.options}>
        <fieldset className={styles.choice}>
          <legend>{t.howManyWords}</legend>
          <div className={styles.segments}>
            {COUNTS.map((value) => (
              <label key={value} className={styles.segment} data-selected={value === count || undefined}>
                <input
                  type="radio"
                  name="count"
                  value={value}
                  checked={value === count}
                  disabled={working}
                  onChange={() => setCount(value)}
                />
                {value}
              </label>
            ))}
          </div>
          <label className={styles.countOwn}>
            <span>{t.orYourOwnNumberUpTo(MAX_COUNT)}</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_COUNT}
              value={count}
              disabled={working}
              onChange={(event) => setCount(Math.min(MAX_COUNT, Math.max(1, Number(event.target.value) || 1)))}
            />
          </label>
        </fieldset>
        <label className={styles.field}>
          <span>{t.level}</span>
          <select value={level} disabled={working} onChange={(event) => setLevel(event.target.value)}>
            {LEVELS.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <TranslationLanguage value={language} disabled={working} onChange={onLanguage} />
      </div>
      <PrimaryButton type="submit" disabled={working || !ready} aria-busy={busy}>
        {busy ? t.pickingWords : t.pick(wordsLabel(count))}
      </PrimaryButton>
      <div role="status" className={styles.generateStatus}>
        {busy && <p className={styles.note}>{t.readingAndMakingCards(count > 20)}</p>}
        {!busy && last && <DraftResult result={last} />}
      </div>
      {error && (
        <p className={styles.problem} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
