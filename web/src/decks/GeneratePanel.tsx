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
  photosLeft,
  onDrafted,
}: {
  deckId: string;
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
        setPhotoNote(
          read.length === 0
            ? 'На фото почти нет текста — снимите страницу ближе и ровнее.'
            : 'На одном из фото почти нет текста — его пропустили.',
        );
      if (read.length > 0) {
        setText((before) => [before.trim(), ...read].filter(Boolean).join('\n\n').slice(0, MAX_TEXT));
        setPhotos((before) => [
          ...before,
          ...files.filter((_, index) => texts[index].length >= MIN_PHOTO_TEXT).map((file) => file.name),
        ]);
      }
    } catch {
      setError('Не удалось прочитать фото. Проверьте интернет: в первый раз загружается модуль чтения (около 7 МБ).');
    } finally {
      setReading(null);
    }
  };

  /** Images dropped or pasted: screenshots straight from the desktop or the clipboard. */
  const addImages = (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith('image/'));
    if (images.length === 0) {
      setPhotoNote('Это не картинка: перетащите скриншот или фото страницы (PNG, JPG).');
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
      const result = await api.generateDeck(deckId, text.trim(), count, level, photos.length);
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
          <CameraIcon /> Отпустите — прочитаем текст с картинки
        </div>
      )}
      <p className={styles.note}>
        Вставьте текст, упражнение или список слов либо сфотографируйте страницу — подберём слова и составим карточки с
        переводом и примером. Ни текст, ни фото не сохраняются.
      </p>
      <label className={styles.field}>
        <span className="visually-hidden">Текст урока</span>
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
          aria-label="Фото страниц"
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
          <CameraIcon aria-hidden="true" /> Добавить фото
        </button>
        <p id="photos-note" className={styles.note}>
          {photosLeft <= 0
            ? `В колоду уже добавлено ${MAX_PHOTOS_PER_DECK} фото — больше нельзя.`
            : `До ${MAX_PHOTOS_PER_DRAFT} за раз · для этой колоды осталось ${photosLeft - photos.length} из ${MAX_PHOTOS_PER_DECK}`}
          {photosLeft > 0 && (
            <span className={styles.desktopOnly}>
              {' '}
              · скриншот можно перетащить сюда или вставить в поле (Ctrl+V, на Mac ⌘V)
            </span>
          )}
        </p>
      </div>
      <div role="status" className={styles.generateStatus}>
        {reading && (
          <>
            <p className={styles.note}>
              Читаем фото {Math.min(reading.total, Math.floor(reading.done) + 1)} из {reading.total}…
            </p>
            <progress className={styles.reading} max={reading.total} value={reading.done} aria-label="Читаем фото" />
          </>
        )}
        {!reading && photos.length > 0 && (
          <p className={styles.note}>
            Текст с {photos.length === 1 ? 'фото' : `${photos.length} фото`} — в поле выше. Проверьте и поправьте, если
            что-то прочиталось неверно.
          </p>
        )}
        {!reading && photoNote && <p className={styles.problem}>{photoNote}</p>}
      </div>

      <div className={styles.options}>
        <fieldset className={styles.choice}>
          <legend>Сколько слов</legend>
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
            <span>или своё число, до {MAX_COUNT}</span>
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
          <span>Уровень учеников</span>
          <select value={level} disabled={working} onChange={(event) => setLevel(event.target.value)}>
            {LEVELS.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      <PrimaryButton type="submit" disabled={working || !ready} aria-busy={busy}>
        {busy ? 'Подбираем слова…' : `Подобрать ${wordsLabel(count)}`}
      </PrimaryButton>
      <div role="status" className={styles.generateStatus}>
        {busy && (
          <p className={styles.note}>
            Читаем текст и составляем карточки — это может занять {count > 20 ? 'пару минут' : 'до минуты'}.
          </p>
        )}
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
