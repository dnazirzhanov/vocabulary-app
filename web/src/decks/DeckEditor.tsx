import type { CardLanguage } from '../i18n/languages.ts';
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
import { TranslationLanguage } from './TranslationLanguage.tsx';
import { TopicPanel } from './TopicPanel.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import styles from './DeckEditor.module.css';
import { t } from '../i18n/index.ts';

const POS: { value: PartOfSpeech; label: string }[] = [
  { value: 'noun', label: t.noun },
  { value: 'verb', label: t.verb },
  { value: 'adjective', label: t.adjective },
  { value: 'adverb', label: t.adverb },
  { value: 'phrase', label: t.expression },
  { value: 'other', label: t.other },
];
const posLabel = (pos: string) => POS.find((option) => option.value === pos)?.label ?? pos;
// Must match the server's rule (backend/app/schemas/decks.py): letters, a phrase joined by one
// space, hyphen or apostrophe.
const HEADWORD = /^[a-z]+([ '-][a-z]+)*$/;
const FLAGS: Record<WordFlag, string> = {
  translation_wrong_language: t.translationWrongLanguage,
  example_without_word: t.theExampleDoesnTContainThis,
  example_long: t.longExample,
};
type ComposerMode = 'words' | 'topic' | 'text' | 'manual';
const COMPOSER_MODES: { value: ComposerMode; label: string }[] = [
  { value: 'words', label: t.words },
  { value: 'topic', label: t.topic },
  { value: 'text', label: t.text },
  { value: 'manual', label: t.byHand },
];
const EMPTY: DeckWordInput = { headword: '', pos: 'noun', translation: '', example: '', example_translation: '' };

interface DeckEditorProps {
  deckId: string;
  /** Where «Назад» leads: «Мои колоды», or the group board it was opened from. */
  backLabel: string;
  /** Back, with the deck's title as it now stands. */
  onDone: (title: string) => void;
  onDeleted: () => void;
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
export function DeckEditor({ deckId, backLabel, onDone, onDeleted, onStudy, onOpenDeck }: DeckEditorProps) {
  const [deck, setDeck] = useState<TeacherDeck | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [form, setForm] = useState<DeckWordInput>(EMPTY);
  // Shared by every way of adding cards, so a choice made on one tab holds on the next (ADR 0055).
  const [language, setLanguage] = useState<CardLanguage>('ru');
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
  const [cardsAdded, setCardsAdded] = useState(0);
  // New cards go on top of the list: bring its heading up so the first of them shows whole. Measured
  // only once they are on the screen: scheduled any earlier, a slow phone measured the old layout.
  useEffect(() => {
    if (cardsAdded > 0) revealFirstCard(listRef.current);
  }, [cardsAdded]);

  const show = useCallback((loaded: TeacherDeck) => {
    setDeck(loaded);
    setTitle(loaded.title);
    setLanguage(loaded.language);
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
      (groups) => setCanGive(groups.some((group) => group.can.includes('give_decks'))),
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
          {t.tryAgain}
        </PrimaryButton>
      </main>
    );
  }
  if (!deck) {
    return (
      <main className="message-screen" aria-busy="true">
        <p>{t.loading}</p>
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
      const card = await api.suggestWord(deck.id, headword, 'B1', language);
      setForm({
        headword: card.headword,
        pos: card.pos,
        translation: card.translation,
        example: card.example,
        example_translation: card.example_translation,
      });
      const notes = card.flags.map((flag) => FLAGS[flag]);
      if (card.provider === 'demo') notes.push(t.demoModeTheTranslationIsnT);
      setSuggestNote(notes.length ? t.check(notes.join(', ')) : t.doneCheckItAndAddIt);
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
    if (headwordInvalid) return setFormError(t.wordEnglishLettersWordsOfA);
    const word = { ...form, headword, language };
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
    if (result.added > 0) setCardsAdded((times) => times + 1);
  };
  const startEdit = (id: string) => {
    const entry = deck.words.find((item) => item.word.id === id);
    if (!entry) return;
    const { headword: h, pos, translation, example, example_translation } = entry.word;
    setLanguage(entry.word.language);
    setForm({ headword: h, pos: pos as PartOfSpeech, translation, example, example_translation });
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
        <button type="button" className={styles.back} onClick={() => onDone(deck.title)}>
          <BackIcon aria-hidden="true" /> {backLabel}
        </button>
      </header>
      <main className={styles.main}>
        <div className={styles.column}>
          <div className={styles.intro}>
            <p className={styles.eyebrow}>{t.myDeck}</p>
            <h1 id="deck-title" ref={headingRef} tabIndex={-1} className="visually-hidden">
              {deck.title}
            </h1>
            <label className={styles.titleField}>
              <span className="visually-hidden">{t.deckName}</span>
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
                  {editing ? t.editCard : t.newCards}
                </h2>
                {/* Giving the deck to a group sits here, beside the cards it will hold (ADR 0036). */}
                {!editing && (canGive || deck.groups.length > 0) && count > 0 && (
                  <GiveButton groups={deck.groups} onClick={() => setGiving(true)} />
                )}
              </div>
              <div className={styles.tabs} role="tablist" aria-label={t.howToAdd}>
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
              {mode === 'words' && (
                <QuickAddPanel deckId={deck.id} language={language} onLanguage={setLanguage} onAdded={drafted} />
              )}
              {mode === 'topic' && (
                <TopicPanel
                  deckId={deck.id}
                  language={language}
                  onLanguage={setLanguage}
                  topics={deck.topics}
                  onAdded={drafted}
                  onOpenDeck={onOpenDeck}
                />
              )}
              {mode === 'text' && (
                <GeneratePanel
                  deckId={deck.id}
                  language={language}
                  onLanguage={setLanguage}
                  photosLeft={deck.photos_left}
                  onDrafted={drafted}
                />
              )}
              {mode === 'manual' && (
                <form
                  className={styles.form}
                  onSubmit={(event) => void submit(event)}
                  aria-labelledby="tab-manual"
                  noValidate
                >
                  <label className={styles.field}>
                    <span>{t.wordOrPhrase}</span>
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
                    {suggesting ? t.fillingIn : t.fillInWithAI}
                  </button>
                  {suggestNote && (
                    <p className={styles.note} role="status">
                      {suggestNote}
                    </p>
                  )}
                  <TranslationLanguage value={language} onChange={setLanguage} />
                  <label className={styles.field}>
                    <span>{t.partOfSpeech}</span>
                    <select value={form.pos} onChange={(event) => field('pos', event.target.value as PartOfSpeech)}>
                      {POS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span>{t.translation}</span>
                    <input
                      required
                      maxLength={120}
                      placeholder={t.carryOutPerform}
                      value={form.translation}
                      onChange={(event) => field('translation', event.target.value)}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>{t.example}</span>
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
                      {t.exampleTranslation} <span className={styles.optional}>{t.optional}</span>
                    </span>
                    <textarea
                      rows={2}
                      maxLength={300}
                      value={form.example_translation}
                      onChange={(event) => field('example_translation', event.target.value)}
                    />
                  </label>
                  {/* Only Russian cards share the course's words (ADR 0055). */}
                  {!editing && language === 'ru' && <p className={styles.note}>{t.aWordFromTheCourseFills}</p>}
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
                      {saving ? t.saving : editing ? t.save : t.addWord}
                    </PrimaryButton>
                    {editing && (
                      <button type="button" className={styles.linkButton} onClick={resetForm}>
                        {t.cancel}
                      </button>
                    )}
                  </div>
                </form>
              )}
            </div>
          </section>

          <section ref={listRef} className={styles.cards} aria-labelledby="cards-title">
            <h2 id="cards-title" className={styles.sectionTitle}>
              {t.cardsInTheDeck}
              {count > 0 && <span className={styles.sectionCount}> · {count}</span>}
            </h2>
            {count === 0 ? (
              <p className={styles.empty}>{t.emptyForNowCardsYouAdd}</p>
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
                          aria-label={t.listen(word.headword)}
                        >
                          <SpeakerIcon aria-hidden="true" />
                        </button>
                        <span className={styles.pos}>{posLabel(word.pos)}</span>
                        {from_course && <span className={styles.courseTag}>{t.fromTheCourse}</span>}
                      </p>
                      <p className={styles.meaning}>{word.translation}</p>
                      <p className={styles.example} lang="en">
                        {word.example}
                      </p>
                      {source_sentence && source_sentence !== word.example && (
                        <p className={styles.source}>
                          <span>{t.fromTheText}</span> <q lang="en">{source_sentence}</q>
                        </p>
                      )}
                      {flags.length > 0 && (
                        <p className={styles.flag}>
                          <AlertIcon aria-hidden="true" />
                          {t.checkColon} {flags.map((flag) => FLAGS[flag]).join(', ')}
                        </p>
                      )}
                    </div>
                    <div className={styles.rowActions}>
                      {!from_course && (
                        <button type="button" className={styles.linkButton} onClick={() => startEdit(word.id)}>
                          {t.edit}
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
                        aria-label={t.remove(word.headword)}
                      >
                        {t.removeAction}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.danger} aria-labelledby="danger-title">
            <h2 id="danger-title" className={styles.sectionTitle}>
              {t.deleteDeck}
            </h2>
            <p className={styles.note}>{t.theCardsAndTheirProgressWill}</p>
            <button type="button" className={styles.dangerButton} onClick={() => setConfirmDelete(true)}>
              <TrashIcon aria-hidden="true" /> {t.deleteDeck}
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
            {count === 0 ? t.study : t.studyWords(wordsLabel(count))}
          </button>
        </div>
      </footer>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title={t.deleteTheDeck(deck.title)}>
        <div className={styles.confirm}>
          <p>{count > 0 ? t.deckWordsWillBeDeleted(count) : t.theDeckWillBeDeletedFor}</p>
          {deck.groups.length > 0 && (
            <p className={styles.confirmWarning}>
              <AlertIcon aria-hidden="true" />
              {t.deckIsGivenWarning(deck.groups.length, deck.groups.map((group) => t.quoted(group.name)).join(', '))}
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
              {t.cancel}
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
                  onDeleted();
                })
              }
            >
              {busy ? t.deleting : t.deleteDeck}
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
