import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, describeError } from '../lib/api.ts';
import { wordsLabel } from '../lib/pace.ts';
import type { DeckWordInput, GenerateResult, PartOfSpeech, Session, TeacherDeck, WordFlag } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { playAudio } from '../lib/audio.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { AlertIcon, BackIcon, PencilIcon, SpeakerIcon, TrashIcon } from '../ui/icons.tsx';
import { GeneratePanel } from './GeneratePanel.tsx';
import { GiveButton } from './GiveButton.tsx';
import { GiveDialog } from './GiveDialog.tsx';
import { QuickAddPanel } from './QuickAddPanel.tsx';
import { TopicPanel } from './TopicPanel.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './DeckEditor.module.css';

const POS: { value: PartOfSpeech; label: string }[] = [
  { value: 'noun', label: 'существительное' },
  { value: 'verb', label: 'глагол' },
  { value: 'adjective', label: 'прилагательное' },
  { value: 'adverb', label: 'наречие' },
  { value: 'phrase', label: 'выражение' },
  { value: 'other', label: 'другое' },
];
const posLabel = (pos: string) => POS.find((option) => option.value === pos)?.label ?? pos;
// Must match the server's rule (backend/app/schemas/decks.py): letters, a phrase joined by one
// space, hyphen or apostrophe.
const HEADWORD = /^[a-z]+([ '-][a-z]+)*$/;
const FLAGS: Record<WordFlag, string> = {
  translation_not_russian: 'перевод не на русском',
  example_without_word: 'в примере нет этого слова',
  example_long: 'длинный пример',
};
type ComposerMode = 'words' | 'topic' | 'text' | 'manual';
const COMPOSER_MODES: { value: ComposerMode; label: string }[] = [
  { value: 'words', label: 'Слова' },
  { value: 'topic', label: 'Тема' },
  { value: 'text', label: 'Текст' },
  { value: 'manual', label: 'Вручную' },
];
const EMPTY: DeckWordInput = { headword: '', pos: 'noun', translation: '', example: '', example_ru: '' };

interface DeckEditorProps {
  deckId: string;
  /** Where «Назад» leads: «Мои колоды», or the group board it was opened from. */
  backLabel: string;
  onDone: () => void;
  /** Studying this deck now (a personal deck's main action). */
  onStudy: (session: Session) => void;
  /** Another of my decks, e.g. one just made for a new topic (ADR 0019). */
  onOpenDeck: (deckId: string) => void;
}

/**
 * A teacher's deck for one group (ADR 0017): the words the students will get, a form to add or
 * correct one, and one action that gives the deck to the group. Students meet the words first in
 * their own daily lesson, at their own pace. Course words are linked, not copied.
 */
export function DeckEditor({ deckId, backLabel, onDone, onStudy, onOpenDeck }: DeckEditorProps) {
  const [deck, setDeck] = useState<TeacherDeck | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [form, setForm] = useState<DeckWordInput>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null); // a word id
  // The composer's way of adding cards: from words (the fast default), from a text, or by hand.
  const [mode, setMode] = useState<ComposerMode>('words');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  // A personal deck can be given to a group I own.
  // Whether I own a group to give this deck to, and the window that does it (ADR 0036).
  const [canGive, setCanGive] = useState(false);
  const [giving, setGiving] = useState(false);
  // Deleting asks first, in a window: a deck and the progress on it can't be brought back.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { run, busy, error } = useAsyncAction();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLElement>(null);

  const show = useCallback((loaded: TeacherDeck) => {
    setDeck(loaded);
    setTitle(loaded.title);
  }, []);
  const load = useCallback(
    () => api.teacherDeck(deckId).then(show, (caught: unknown) => setLoadError(describeError(caught))),
    [deckId, show],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    api.groups().then(
      (groups) => setCanGive(groups.some((group) => group.role === 'owner')),
      () => setCanGive(false),
    );
  }, []);
  const focused = useRef(false);
  useEffect(() => {
    if (!deck || focused.current) return;
    focused.current = true;
    headingRef.current?.focus();
  }, [deck]);

  if (loadError) {
    return (
      <main className="message-screen">
        <p role="alert">{loadError}</p>
        <PrimaryButton type="button" onClick={() => (setLoadError(null), void load())}>
          Повторить
        </PrimaryButton>
      </main>
    );
  }
  if (!deck) {
    return (
      <main className="message-screen" aria-busy="true">
        <p>Загружаем…</p>
      </main>
    );
  }

  const count = deck.words.length;
  const field = <K extends keyof DeckWordInput>(key: K, value: DeckWordInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const headword = form.headword.trim().toLowerCase();
  const headwordInvalid = headword !== '' && !HEADWORD.test(headword);

  const saveTitle = () => {
    const clean = title.trim();
    if (clean.length < 2 || clean === deck.title) return setTitle(deck.title);
    run(async () => show(await api.renameDeck(deck.id, clean)));
  };
  // The rest of the card from the typed word, for review before adding (nothing is saved).
  const suggest = async () => {
    if (suggesting || !headword || headwordInvalid) return;
    setSuggesting(true);
    setSuggestNote(null);
    setFormError(null);
    try {
      const card = await api.suggestWord(deck.id, headword, 'B1');
      setForm({
        headword: card.headword,
        pos: card.pos,
        translation: card.translation,
        example: card.example,
        example_ru: card.example_ru,
      });
      const notes = card.flags.map((flag) => FLAGS[flag]);
      if (card.provider === 'demo') notes.push('демо-режим, перевод ненастоящий');
      setSuggestNote(notes.length ? `Проверьте: ${notes.join(', ')}.` : 'Готово — проверьте и добавьте.');
    } catch (caught) {
      setFormError(describeError(caught));
    } finally {
      setSuggesting(false);
    }
  };
  const resetForm = () => {
    setForm(EMPTY);
    setEditing(null);
    setFormError(null);
    setSuggestNote(null);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (headwordInvalid) return setFormError('Слово: английские буквы; слова выражения — через пробел или дефис.');
    const word = { ...form, headword };
    setSaving(true);
    setFormError(null);
    try {
      show(editing ? await api.editDeckWord(deck.id, editing, word) : await api.addDeckWord(deck.id, word));
      resetForm();
      firstField.current?.focus();
    } catch (caught) {
      setFormError(describeError(caught));
    } finally {
      setSaving(false);
    }
  };
  // New cards are listed first, under the composer: bring them into view if they're below it.
  const drafted = (result: GenerateResult) => {
    show(result.deck);
    // New cards go on top of the list: bring its heading up so the first of them shows whole.
    if (result.added > 0) requestAnimationFrame(() => revealFirstCard(listRef.current));
  };
  const startEdit = (id: string) => {
    const entry = deck.words.find((item) => item.word.id === id);
    if (!entry) return;
    const { headword: h, pos, translation, example, example_ru } = entry.word;
    setForm({ headword: h, pos: pos as PartOfSpeech, translation, example, example_ru });
    setEditing(id);
    setFormError(null);
    setMode('manual');
    requestAnimationFrame(() => {
      reveal(composerRef.current, true);
      firstField.current?.focus({ preventScroll: true });
    });
  };

  return (
    <div className={styles.screen}>
      <header className={styles.topbar}>
        <button type="button" className={styles.back} onClick={onDone}>
          <BackIcon aria-hidden="true" /> {backLabel}
        </button>
      </header>
      <main className={styles.main}>
        <div className={styles.column}>
          <div className={styles.intro}>
            <p className={styles.eyebrow}>Моя колода</p>
            <h1 id="deck-title" ref={headingRef} tabIndex={-1} className="visually-hidden">
              {deck.title}
            </h1>
            <label className={styles.titleField}>
              <span className="visually-hidden">Название колоды</span>
              <input
                value={title}
                maxLength={80}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={saveTitle}
                onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
              />
              {/* The title is edited right here; the pencil says so (ADR 0035). */}
              <PencilIcon className={styles.titlePencil} aria-hidden="true" />
            </label>
          </div>

          {/* The screen's main job: making cards. One way at a time, chosen by tabs. */}
          <section ref={composerRef} className={styles.composer} aria-labelledby="composer-title">
            <div className={styles.composerHead}>
              <div className={styles.composerTop}>
                <h2 id="composer-title" className={styles.composerTitle}>
                  {editing ? 'Изменить карточку' : 'Новые карточки'}
                </h2>
                {/* Giving the deck to a group sits here, beside the cards it will hold (ADR 0036). */}
                {!editing && (canGive || deck.groups.length > 0) && count > 0 && (
                  <GiveButton groups={deck.groups} onClick={() => setGiving(true)} />
                )}
              </div>
              <div className={styles.tabs} role="tablist" aria-label="Как добавить">
                {COMPOSER_MODES.map((option) => (
                  <button
                    key={option.value}
                    id={`tab-${option.value}`}
                    type="button"
                    role="tab"
                    aria-selected={mode === option.value}
                    aria-controls={`pane-${option.value}`}
                    className={styles.tab}
                    onClick={() => setMode(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div id={`pane-${mode}`} role="tabpanel" aria-labelledby={`tab-${mode}`} className={styles.pane}>
              {mode === 'words' && <QuickAddPanel deckId={deck.id} onAdded={drafted} />}
              {mode === 'topic' && (
                <TopicPanel deckId={deck.id} topics={deck.topics} onAdded={drafted} onOpenDeck={onOpenDeck} />
              )}
              {mode === 'text' && <GeneratePanel deckId={deck.id} photosLeft={deck.photos_left} onDrafted={drafted} />}
              {mode === 'manual' && (
                <form
                  className={styles.form}
                  onSubmit={(event) => void submit(event)}
                  aria-labelledby="tab-manual"
                  noValidate
                >
                  <label className={styles.field}>
                    <span>Слово или выражение</span>
                    <input
                      ref={firstField}
                      lang="en"
                      required
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      maxLength={64}
                      placeholder="carry out"
                      value={form.headword}
                      aria-invalid={headwordInvalid || undefined}
                      onChange={(event) => field('headword', event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className={styles.linkButton}
                    disabled={suggesting || !headword || headwordInvalid}
                    aria-busy={suggesting}
                    onClick={() => void suggest()}
                  >
                    {suggesting ? 'Заполняем…' : 'Заполнить с ИИ'}
                  </button>
                  {suggestNote && (
                    <p className={styles.note} role="status">
                      {suggestNote}
                    </p>
                  )}
                  <label className={styles.field}>
                    <span>Часть речи</span>
                    <select value={form.pos} onChange={(event) => field('pos', event.target.value as PartOfSpeech)}>
                      {POS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span>Перевод</span>
                    <input
                      required
                      maxLength={120}
                      placeholder="проводить, выполнять"
                      value={form.translation}
                      onChange={(event) => field('translation', event.target.value)}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Пример</span>
                    <textarea
                      lang="en"
                      required
                      rows={2}
                      maxLength={300}
                      placeholder="They carried out the experiment."
                      value={form.example}
                      onChange={(event) => field('example', event.target.value)}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>
                      Перевод примера <span className={styles.optional}>— необязательно</span>
                    </span>
                    <textarea
                      rows={2}
                      maxLength={300}
                      value={form.example_ru}
                      onChange={(event) => field('example_ru', event.target.value)}
                    />
                  </label>
                  {!editing && (
                    <p className={styles.note}>Слово из курса подставится само — ученики не выучат его дважды.</p>
                  )}
                  {formError && (
                    <p className={styles.problem} role="alert">
                      {formError}
                    </p>
                  )}
                  <div className={styles.formActions}>
                    <PrimaryButton
                      type="submit"
                      disabled={saving || !headword || !form.translation.trim() || !form.example.trim()}
                      aria-busy={saving}
                    >
                      {saving ? 'Сохраняем…' : editing ? 'Сохранить' : 'Добавить слово'}
                    </PrimaryButton>
                    {editing && (
                      <button type="button" className={styles.linkButton} onClick={resetForm}>
                        Отмена
                      </button>
                    )}
                  </div>
                </form>
              )}
            </div>
          </section>

          <section ref={listRef} className={styles.cards} aria-labelledby="cards-title">
            <h2 id="cards-title" className={styles.sectionTitle}>
              Карточки в колоде{count > 0 && <span className={styles.sectionCount}> · {count}</span>}
            </h2>
            {count === 0 ? (
              <p className={styles.empty}>Пока пусто. Добавленные карточки появятся здесь — новые сверху.</p>
            ) : (
              <ul className={styles.words}>
                {[...deck.words].reverse().map(({ word, from_course, source_sentence, flags }) => (
                  <li key={word.id} className={styles.word} data-editing={editing === word.id || undefined}>
                    <div className={styles.wordBody}>
                      <p className={styles.wordHead}>
                        <strong lang="en">{word.headword}</strong>
                        <button
                          type="button"
                          className={styles.listen}
                          onClick={() => void playAudio('words', word.id, word.headword)}
                          aria-label={`Послушать: ${word.headword}`}
                        >
                          <SpeakerIcon aria-hidden="true" />
                        </button>
                        <span className={styles.pos}>{posLabel(word.pos)}</span>
                        {from_course && <span className={styles.courseTag}>из курса</span>}
                      </p>
                      <p className={styles.meaning}>{word.translation}</p>
                      <p className={styles.example} lang="en">
                        {word.example}
                      </p>
                      {source_sentence && source_sentence !== word.example && (
                        <p className={styles.source}>
                          <span>Из текста:</span> <q lang="en">{source_sentence}</q>
                        </p>
                      )}
                      {flags.length > 0 && (
                        <p className={styles.flag}>
                          <AlertIcon aria-hidden="true" />
                          Проверьте: {flags.map((flag) => FLAGS[flag]).join(', ')}
                        </p>
                      )}
                    </div>
                    <div className={styles.rowActions}>
                      {!from_course && (
                        <button type="button" className={styles.linkButton} onClick={() => startEdit(word.id)}>
                          Изменить
                        </button>
                      )}
                      <button
                        type="button"
                        className={styles.linkButton}
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            if (editing === word.id) resetForm();
                            show(await api.removeDeckWord(deck.id, word.id));
                          })
                        }
                        aria-label={`Убрать «${word.headword}»`}
                      >
                        Убрать
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.danger} aria-labelledby="danger-title">
            <h2 id="danger-title" className={styles.sectionTitle}>
              Удалить колоду
            </h2>
            <p className={styles.note}>Карточки и прогресс по ним удалятся навсегда.</p>
            <button type="button" className={styles.dangerButton} onClick={() => setConfirmDelete(true)}>
              <TrashIcon aria-hidden="true" /> Удалить колоду
            </button>
          </section>
        </div>
      </main>

      <footer className={styles.actions}>
        <div className={styles.actionsInner}>
          {error && (
            <p className={styles.problem} role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            className={styles.study}
            disabled={busy || count === 0}
            aria-busy={busy}
            onClick={() => run(async () => onStudy(await api.startStudySession(deck.id)))}
          >
            {count === 0 ? 'Учить' : `Учить · ${wordsLabel(count)}`}
          </button>
        </div>
      </footer>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Удалить колоду «${deck.title}»?`}>
        <div className={styles.confirm}>
          <p>
            {count > 0
              ? `${wordsLabel(count)} и прогресс по ${count === 1 ? 'нему' : 'ним'} удалятся навсегда — вернуть их не получится.`
              : 'Колода удалится навсегда.'}
          </p>
          {deck.groups.length > 0 && (
            <p className={styles.confirmWarning}>
              <AlertIcon aria-hidden="true" />
              Колода задана {deck.groups.length === 1 ? 'группе' : 'группам'}{' '}
              {deck.groups.map((group) => `«${group.name}»`).join(', ')} — у участников она тоже пропадёт.
            </p>
          )}
          <div className={styles.confirmActions}>
            {/* Cancel takes focus first, so a reflexive Enter never deletes. */}
            <button
              type="button"
              className={styles.outlineButton}
              data-autofocus
              onClick={() => setConfirmDelete(false)}
            >
              Отмена
            </button>
            <button
              type="button"
              className={styles.dangerSolid}
              disabled={busy}
              aria-busy={busy}
              onClick={() =>
                run(async () => {
                  await api.deleteDeck(deck.id);
                  setConfirmDelete(false);
                  onDone();
                })
              }
            >
              {busy ? 'Удаляем…' : 'Удалить колоду'}
            </button>
          </div>
          {error && (
            <p className={styles.problem} role="alert">
              {error}
            </p>
          )}
        </div>
      </Dialog>
      {giving && <GiveDialog deckId={deck.id} onClose={() => setGiving(false)} onChanged={show} />}
    </div>
  );
}

/** Scrolls the editor's own area (not the page) so `element` is in view; `top`: to its top. */
/** Scrolls the list up to its heading unless its first card is already fully in view. */
function revealFirstCard(list: HTMLElement | null) {
  const first = list?.querySelector('li');
  const main = list?.closest('main');
  if (!list || !first || !main) return;
  const card = first.getBoundingClientRect();
  const view = main.getBoundingClientRect();
  if (card.top >= view.top && card.bottom <= view.bottom) return;
  reveal(list, true);
}

function reveal(element: HTMLElement | null, top = false) {
  const main = element?.closest('main');
  if (!element || !main) return;
  const box = element.getBoundingClientRect();
  const view = main.getBoundingClientRect();
  if (!top && box.top >= view.top && box.top < view.bottom - 120) return;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  main.scrollTo({ top: main.scrollTop + box.top - view.top - 16, behavior: still ? 'auto' : 'smooth' });
}
