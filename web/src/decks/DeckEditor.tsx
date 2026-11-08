import type { CardLanguage } from '../i18n/languages.ts';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, describeError } from '../lib/api.ts';
import { wordsLabel } from '../lib/pace.ts';
import type { DeckWordInput, GenerateResult, PartOfSpeech, Session, TeacherDeck, WordFlag } from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { playAudio } from '../lib/audio.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { AlertIcon, BackIcon, PencilIcon, SpeakerIcon, TrashIcon } from '../ui/icons.tsx';
import { deckView, type DeckView } from '../local/deckView.ts';
import {
  addCard,
  deleteDeck,
  editCard,
  keepMine,
  rememberServerDeck,
  removeCard,
  renameDeck,
  takeServer,
  type ServerDeck,
} from '../local/myDecks.ts';
import type { Problem } from '../local/db.ts';
import { localDb, withSnapshot } from '../local/session.ts';
import { syncNow, syncSoon, useLocalVersion } from '../local/sync.ts';
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
  // What is being typed as the title; otherwise the deck's own.
  const [draftTitle, setDraftTitle] = useState<string | null>(null);
  const [form, setForm] = useState<DeckWordInput>(EMPTY);
  // Shared by every way of adding cards, so a choice made on one tab holds on the next (ADR 0055).
  const [chosenLanguage, setLanguage] = useState<CardLanguage | null>(null);
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
  // Its own, so a title typed while a card is being removed is never dropped for being "busy".
  const renaming = useAsyncAction();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLElement>(null);
  // Cards drafted with AI: once the list shows them (it may come a moment later, from this
  // device's copy), bring the first into view. Measured only once they are on the screen: scheduled
  // any earlier, a slow phone measured the old layout.
  const revealAt = useRef<number | null>(null);
  const shownCount = deck?.words.length ?? 0;
  useEffect(() => {
    if (revealAt.current === null || shownCount <= revealAt.current) return;
    revealAt.current = null;
    revealFirstCard(listRef.current);
  }, [shownCount]);

  // The server's view of the deck (its cards' warnings, groups, topics), kept for offline; the
  // deck itself comes from this device when it has it (ADR 0061), so changes need no connection.
  const [server, setServer] = useState<TeacherDeck | null>(null);
  const [view, setView] = useState<DeckView | null>(null);
  // Whether the server has answered (or can't be reached): what only it knows (topics, groups,
  // warnings) is in before the editor is used, as it was when it always came from there.
  const [settled, setSettled] = useState(false);
  const localVersion = useLocalVersion();
  // Shown from the server only while this device doesn't have the deck.
  const fromDevice = useRef(false);
  const show = useCallback((loaded: TeacherDeck) => {
    setServer(loaded);
    if (!fromDevice.current) setDeck(loaded);
  }, []);
  // Only the latest load counts: an older answer arriving late must not undo what was typed since.
  const loads = useRef(0);
  const load = useCallback(() => {
    const mine = ++loads.current;
    return withSnapshot(`edit:${deckId}`, () => api.teacherDeck(deckId)).then(
      ({ value }) => {
        if (mine !== loads.current) return;
        show(value);
        setSettled(true);
      },
      async (caught: unknown) => {
        // Made on this device and not sent yet, or no connection: this device's copy is enough.
        const db = localDb();
        if (mine !== loads.current) return;
        if (db && (await db.get('decks', deckId))) setSettled(true);
        else setLoadError(describeError(caught));
      },
    );
  }, [deckId, show]);
  useEffect(() => {
    void load();
    // Anything made here while offline goes first, so the server's own tools (AI, groups) find it.
    void syncNow();
  }, [load]);
  useEffect(() => {
    const db = localDb();
    if (!db || !settled) return;
    void deckView(db, deckId, server).then((found) => {
      fromDevice.current = found !== null;
      setView(found);
      if (found) setDeck(found.deck);
    });
  }, [deckId, server, settled, localVersion]);
  const title = draftTitle ?? deck?.title ?? '';
  // The deck's last language until one is chosen here (ADR 0055).
  const language: CardLanguage = chosenLanguage ?? deck?.language ?? 'ru';
  /** My deck is changed on this device when it has it; otherwise on the server, as before. */
  const local = view ? localDb() : null;
  const changed = (updated?: TeacherDeck) => {
    if (updated) {
      show(updated);
      // Changed on the server (AI, giving to a group): this device keeps it at once.
      const db = localDb();
      if (db) void rememberServerDeck(db, asServerDeck(updated)).then(() => syncSoon());
      return;
    }
    syncSoon();
  };
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
    setDraftTitle(null);
    if (clean.length < 2 || clean === deck.title) return;
    void renaming.run(async () => {
      if (!local) return changed(await api.renameDeck(deck.id, clean));
      await renameDeck(local, deck.id, clean);
      changed();
    });
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
      if (!local)
        changed(editing ? await api.editDeckWord(deck.id, editing, word) : await api.addDeckWord(deck.id, word));
      else {
        if (editing) await editCard(local, editing, word);
        else await addCard(local, deck.id, word);
        changed();
      }
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
    changed(result.deck);
    if (result.added > 0) revealAt.current = deck?.words.length ?? 0;
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
                id="deck-title-field"
                value={title}
                maxLength={80}
                onChange={(event) => setDraftTitle(event.target.value)}
                onBlur={saveTitle}
                onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
              />
              {/* The title is edited right here; the pencil says so (ADR 0035). */}
              <PencilIcon className={styles.titlePencil} aria-hidden="true" />
            </label>
            {renaming.error && (
              <p className={styles.problem} role="alert">
                {renaming.error}
              </p>
            )}
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
                      {view?.waiting.has(word.id) && <p className={styles.waiting}>{t.waitingToSend}</p>}
                      {local && view?.problems.get(word.id) && (
                        <CardProblem
                          problem={view.problems.get(word.id)!}
                          onKeepMine={() => run(async () => (await keepMine(local, word.id), changed()))}
                          onTakeTheOther={() => run(async () => (await takeServer(local, word.id), changed()))}
                        />
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
                            if (!local) return changed(await api.removeDeckWord(deck.id, word.id));
                            await removeCard(local, word.id);
                            changed();
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
            onClick={() =>
              run(async () => {
                // Studying is the server's: what was made here goes first.
                await syncNow();
                onStudy(await api.startStudySession(deck.id));
              })
            }
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
                  if (local) {
                    await deleteDeck(local, deck.id);
                    syncSoon();
                  } else await api.deleteDeck(deck.id);
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
      {giving && <GiveDialog deckId={deck.id} onClose={() => setGiving(false)} onChanged={(given) => changed(given)} />}
    </div>
  );
}

/** The editor's deck from the server, as sync names it (cards in order). */
function asServerDeck(deck: TeacherDeck): ServerDeck {
  return {
    id: deck.id,
    title: deck.title,
    language: deck.language,
    status: deck.status,
    version: 1,
    created_at: deck.created_at,
    cards: deck.words.map(({ word, from_course }, index) => ({
      ...word,
      version: 1,
      position: index + 1,
      from_course,
    })),
  };
}

/**
 * A change the server didn't take as it was (ADR 0061): changed on another device meanwhile (a
 * choice between the two), or refused (its reason; the card can be corrected or removed).
 */
function CardProblem({
  problem,
  onKeepMine,
  onTakeTheOther,
}: {
  problem: Problem;
  onKeepMine: () => void;
  onTakeTheOther: () => void;
}) {
  if (problem.status === 'conflict') {
    const theirs = Object.values(problem.conflicts ?? {})
      .map((value) => String(value.server))
      .join(' · ');
    return (
      <div className={styles.problemBox} role="group" aria-label={t.changedOnAnotherDevice(theirs)}>
        <p className={styles.flag}>
          <AlertIcon aria-hidden="true" />
          {t.changedOnAnotherDevice(theirs)}
        </p>
        <div className={styles.problemActions}>
          <button type="button" className={styles.linkButton} onClick={onKeepMine}>
            {t.keepMine}
          </button>
          <button type="button" className={styles.linkButton} onClick={onTakeTheOther}>
            {t.takeTheOther}
          </button>
        </div>
      </div>
    );
  }
  return (
    <p className={styles.flag}>
      <AlertIcon aria-hidden="true" />
      {t.notSaved(describeError(Object.assign(new Error(), { code: problem.code ?? '' })))}
    </p>
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
