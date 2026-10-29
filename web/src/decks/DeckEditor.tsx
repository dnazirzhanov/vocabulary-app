import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, describeError } from '../lib/api.ts';
import { wordsLabel } from '../lib/pace.ts';
import type {
  DeckWordInput,
  GenerateResult,
  Group,
  PartOfSpeech,
  Session,
  TeacherDeck,
  WordFlag,
} from '../lib/types.ts';
import { useAsyncAction } from '../lib/useAsyncAction.ts';
import { playAudio } from '../lib/audio.ts';
import { AlertIcon, BackIcon, CheckIcon, SpeakerIcon } from '../ui/icons.tsx';
import { GeneratePanel } from './GeneratePanel.tsx';
import { QuickAddPanel } from './QuickAddPanel.tsx';
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
const EMPTY: DeckWordInput = { headword: '', pos: 'noun', translation: '', example: '', example_ru: '' };

interface DeckEditorProps {
  deckId: string;
  /** Opened from a group's board: the deck is for that group. None: a personal deck (ADR 0019). */
  groupId: string | null;
  groupName: string | null;
  onDone: () => void;
  /** Studying this deck now (a personal deck's main action). */
  onStudy: (session: Session) => void;
}

/**
 * A teacher's deck for one group (ADR 0017): the words the students will get, a form to add or
 * correct one, and one action that gives the deck to the group. Students meet the words first in
 * their own daily lesson, at their own pace. Course words are linked, not copied.
 */
export function DeckEditor({ deckId, groupId, groupName, onDone, onStudy }: DeckEditorProps) {
  const [deck, setDeck] = useState<TeacherDeck | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [form, setForm] = useState<DeckWordInput>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null); // a word id
  // The manual form, folded away: drafting from the lesson's text comes first (ADR 0018).
  const [manualOpen, setManualOpen] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  // A personal deck can be given to a group I own.
  const [ownGroups, setOwnGroups] = useState<Group[]>([]);
  const [giveTo, setGiveTo] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justGiven, setJustGiven] = useState(false);
  const { run, busy, error } = useAsyncAction();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLElement>(null);

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
    if (groupId) return;
    api.groups().then(
      (groups) => {
        const owned = groups.filter((group) => group.role === 'owner');
        setOwnGroups(owned);
        setGiveTo(owned[0]?.id ?? '');
      },
      () => setOwnGroups([]),
    );
  }, [groupId]);
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

  const forGroup = groupId !== null;
  const given = forGroup && deck.groups.some((group) => group.id === groupId);
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
      setJustGiven(false);
      resetForm();
      firstField.current?.focus();
    } catch (caught) {
      setFormError(describeError(caught));
    } finally {
      setSaving(false);
    }
  };
  // On a phone the list sits above the panel: bring the new cards into view for review.
  const drafted = (result: GenerateResult) => {
    show(result.deck);
    setJustGiven(false);
    if (result.added > 0 && window.matchMedia('(max-width: 1023px)').matches) {
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      // Only the editor's own scrolling area moves (scrollIntoView would shift the whole page).
      requestAnimationFrame(() =>
        listRef.current?.closest('main')?.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' }),
      );
    }
  };
  const startEdit = (id: string) => {
    const entry = deck.words.find((item) => item.word.id === id);
    if (!entry) return;
    const { headword: h, pos, translation, example, example_ru } = entry.word;
    setForm({ headword: h, pos: pos as PartOfSpeech, translation, example, example_ru });
    setEditing(id);
    setFormError(null);
    setManualOpen(true);
    requestAnimationFrame(() => firstField.current?.focus());
  };

  return (
    <div className={styles.screen}>
      <header className={styles.topbar}>
        <button type="button" className={styles.back} onClick={onDone}>
          <BackIcon aria-hidden="true" /> {forGroup ? 'К группе' : 'Мои колоды'}
        </button>
      </header>
      <main className={styles.main}>
        <div className={styles.layout}>
          <section ref={listRef} className={styles.listColumn} aria-labelledby="deck-title">
            <p className={styles.eyebrow}>{forGroup ? `Слова для группы «${groupName}»` : 'Моя колода'}</p>
            <h1 id="deck-title" ref={headingRef} tabIndex={-1} className="visually-hidden">
              {deck.title}
            </h1>
            <label className={styles.titleField}>
              <span className="visually-hidden">Название набора</span>
              <input
                value={title}
                maxLength={80}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={saveTitle}
                onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
              />
            </label>
            <p className={styles.lead}>
              {forGroup
                ? 'Ученики встретят эти слова первыми в своём ежедневном уроке — в своём темпе, без лишней нагрузки.'
                : 'Колода учится, когда вы её открываете: новые слова — в пределах вашего темпа.'}
            </p>

            {count === 0 ? (
              <p className={styles.empty}>Пока ни одного слова. Вставьте текст урока — карточки появятся здесь.</p>
            ) : (
              <ol className={styles.words}>
                {deck.words.map(({ word, from_course, source_sentence, flags }, index) => (
                  <li key={word.id} className={styles.word} data-editing={editing === word.id || undefined}>
                    <span className={styles.number} aria-hidden="true">
                      {index + 1}
                    </span>
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
              </ol>
            )}
          </section>

          <div className={styles.side}>
            <QuickAddPanel deckId={deck.id} forGroup={forGroup} onAdded={drafted} />
            <GeneratePanel deckId={deck.id} forGroup={forGroup} onDrafted={drafted} />
            <details
              className={styles.manual}
              open={manualOpen}
              onToggle={(event) => setManualOpen(event.currentTarget.open)}
            >
              <summary className={styles.manualSummary}>
                {editing ? 'Изменить слово' : 'Добавить слово вручную'}
              </summary>
              <form
                className={styles.form}
                onSubmit={(event) => void submit(event)}
                aria-label={editing ? 'Изменить слово' : 'Добавить слово вручную'}
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
                  <button
                    type="submit"
                    className={styles.outlineButton}
                    disabled={saving || !headword || !form.translation.trim() || !form.example.trim()}
                    aria-busy={saving}
                  >
                    {saving ? 'Сохраняем…' : editing ? 'Сохранить' : 'Добавить слово'}
                  </button>
                  {editing && (
                    <button type="button" className={styles.linkButton} onClick={resetForm}>
                      Отмена
                    </button>
                  )}
                </div>
              </form>
            </details>
          </div>
        </div>
      </main>

      <footer className={styles.actions}>
        <div className={styles.actionsInner}>
          {error && (
            <p className={styles.problem} role="alert">
              {error}
            </p>
          )}
          {!forGroup ? (
            <>
              {deck.groups.length > 0 && (
                <p className={styles.status} role="status">
                  <CheckIcon aria-hidden="true" />В группе {deck.groups.map((group) => `«${group.name}»`).join(', ')}
                </p>
              )}
              {ownGroups.length > 0 && count > 0 && (
                <div className={styles.giveRow}>
                  <label className={styles.giveLabel}>
                    <span>Дать группе</span>
                    <select value={giveTo} onChange={(event) => setGiveTo(event.target.value)}>
                      {ownGroups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className={styles.outlineButton}
                    disabled={busy || !giveTo || deck.groups.some((group) => group.id === giveTo)}
                    onClick={() => run(async () => show(await api.giveDeck(deck.id, giveTo)))}
                  >
                    {deck.groups.some((group) => group.id === giveTo) ? 'Уже задано' : 'Задать'}
                  </button>
                </div>
              )}
              <PrimaryButton
                type="button"
                className={styles.action}
                disabled={busy || count === 0}
                aria-busy={busy}
                onClick={() => run(async () => onStudy(await api.startStudySession(deck.id)))}
              >
                {count === 0 ? 'Учить' : `Учить · ${wordsLabel(count)}`}
              </PrimaryButton>
            </>
          ) : given ? (
            <>
              <p className={styles.status} role="status">
                <CheckIcon aria-hidden="true" />
                {justGiven
                  ? `Задано группе «${groupName}»: ${wordsLabel(count)}`
                  : `Группе «${groupName}» задано. Правки сразу видны ученикам.`}
              </p>
              <PrimaryButton type="button" className={styles.action} onClick={onDone}>
                Готово
              </PrimaryButton>
            </>
          ) : (
            <PrimaryButton
              type="button"
              className={styles.action}
              disabled={busy || count === 0}
              aria-busy={busy}
              onClick={() =>
                run(async () => {
                  show(await api.giveDeck(deck.id, groupId));
                  setJustGiven(true);
                })
              }
            >
              {count === 0 ? 'Задать группе' : `Задать группе · ${wordsLabel(count)}`}
            </PrimaryButton>
          )}
        </div>
      </footer>
    </div>
  );
}
