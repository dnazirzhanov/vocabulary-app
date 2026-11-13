import { useEffect, useMemo, useState } from 'react';
import { api, describeError } from '../lib/api.ts';
import { localToday } from '../lib/deadline.ts';
import type { GivenQuestion, GivenWord, GroupSummary } from '../lib/types.ts';
import { localDb } from '../local/session.ts';
import { BackIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { t } from '../i18n/index.ts';
import { HEADING, loadArticle, type Article } from './articles.ts';
import { basketCards, findDeck, readingRef } from './basket.ts';
import { pieces, sentenceAt } from './text.ts';
import { editable, QuestionsEditor, sound } from './QuestionsEditor.tsx';
import styles from './GiveReading.module.css';

/** Words offered before «Показать ещё»: the giver's own kept ones first, then the text's. */
const FIRST_WORDS = 24;
const CARD_POS = new Set(['noun', 'verb', 'adjective', 'adverb', 'phrase']);
/**
 * Everyday words a giver would not pick to teach from a text (among English's most frequent): left
 * out of the offered words, unless the giver kept one from it themselves.
 */
const EVERYDAY = new Set(
  'able about actually add after again air all allow almost already also always any appear area art ask back bad be before begin believe big body book both bring build business buy call car case change child city come community company consider continue create cut day decide die different do door each early education either end enough even every expect eye face fact fall father feel few find first follow force friend further game generally get girl give go good government great grow guy hand happen have head health hear here high history hold home hour house how however idea important include information instead into issue job just keep kid kill kind know large last law lead learn leave let level life like likely line little live long look lose lot love make man many mean meet member minute moment money month more morning most mother move much name neither never new next night no not now number offer office often old once only open other others out over own parent part party pass pay person place play point power president program provide public pull put question raise reach read really reason remain remember report require research result right room run same say see seem sell send serve service set show side simply sit small so some sometimes speak spend stand stay still stop story study such suggest system take teacher team tell then there thing think time together too try under understand up use usually very wait walk want war watch water way week well when where why win woman word work world write year young'.split(
    ' ',
  ),
);

/** Every word worth a card, once by its dictionary form, in the order the text meets it. */
function candidates(article: Article, kept: ReadonlySet<string>): GivenWord[] {
  const found = new Map<string, GivenWord>();
  article.body.forEach((paragraph) => {
    const text = paragraph.replace(HEADING, '');
    for (const piece of pieces(text)) {
      const meaning = piece.key ? article.glossary[piece.key] : undefined;
      if (!meaning || !meaning.p || !CARD_POS.has(meaning.p)) continue;
      const headword = meaning.l.toLowerCase();
      if (found.has(headword) || !/^[a-z]+(?:[ '-][a-z]+)*$/.test(headword)) continue;
      if (EVERYDAY.has(headword) && !kept.has(headword)) continue;
      found.set(headword, {
        headword,
        pos: meaning.p,
        translation: meaning.t.slice(0, 120),
        example: sentenceAt(text, piece.start),
        language: article.language,
      });
    }
  });
  return [...found.values()];
}

/**
 * «Дать группе» (round 2, D): one screen, top to bottom — the group and a deadline, the words to
 * learn from the text, the questions (the giver's to change, add or drop), then «Дать группе».
 * The opposite of a form in a classroom tool: everything starts filled in; most givers only pick
 * the group.
 */
export function GiveReading({
  account,
  articleId,
  onBack,
}: {
  account: string;
  articleId: string;
  onBack: () => void;
}) {
  const [article, setArticle] = useState<Article | null>(null);
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [due, setDue] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // The words the giver kept from this text: offered even if everyday, and picked to start with.
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [questions, setQuestions] = useState<GivenQuestion[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [given, setGiven] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [loaded, mine] = await Promise.all([loadArticle(articleId), api.groups()]);
        if (!live) return;
        setArticle(loaded);
        setQuestions(editable(loaded.questions));
        setGroups(mine);
        if (mine.length === 1) setGroupId(mine[0].id);
        // The words the giver kept from this text are picked to start with.
        const db = localDb();
        if (db) {
          const kept = await basketCards(db, await findDeck(db, account, loaded.id, loaded.title));
          const headwords = new Set(kept.map((card) => card.headword.toLowerCase()));
          if (live) {
            setKept(headwords);
            setPicked(headwords);
          }
        }
      } catch (error) {
        if (live) setProblem(describeError(error));
      }
    })();
    return () => {
      live = false;
    };
  }, [account, articleId]);

  const words = useMemo(() => (article ? candidates(article, kept) : []), [article, kept]);
  // The picked ones first, so they stay in sight.
  const ordered = useMemo(
    () => [...words.filter((word) => picked.has(word.headword)), ...words.filter((word) => !picked.has(word.headword))],
    [words, picked],
  );
  const shown = showAll ? ordered : ordered.slice(0, Math.max(FIRST_WORDS, picked.size));

  const toggle = (headword: string) =>
    setPicked((before) => {
      const next = new Set(before);
      if (next.has(headword)) next.delete(headword);
      else next.add(headword);
      return next;
    });

  const give = async () => {
    if (!article || !groupId) return;
    if (!questions.every(sound)) return setProblem(t.questionsNeedFixing);
    setBusy(true);
    setProblem(null);
    try {
      const done = await api.giveReading({
        group_id: groupId,
        reading_ref: readingRef(article.id),
        words: words.filter((word) => picked.has(word.headword)),
        questions: questions.map((one) => ({ ...one, q: one.q.trim() })),
        due_on: due || null,
      });
      setGiven(done.group_name);
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.screen}>
      <header className={styles.topbar}>
        <button type="button" className={styles.back} onClick={onBack}>
          <BackIcon aria-hidden="true" /> {t.backToText}
        </button>
      </header>
      <main className={styles.main}>
        <div className={styles.column}>
          <h1 className={styles.title}>{t.giveToAGroup}</h1>
          {article && (
            <p className={styles.subtitle} lang="en">
              {article.title}
            </p>
          )}
          {given ? (
            <div className={styles.done} role="status">
              <p>{t.givenToGroup(given)}</p>
              <PrimaryButton type="button" onClick={onBack}>
                {t.backToText}
              </PrimaryButton>
            </div>
          ) : (
            <>
              {groups && groups.length === 0 && <p className={styles.note}>{t.noGroupToGive}</p>}
              {groups && groups.length > 0 && article && (
                <>
                  <fieldset className={styles.block}>
                    <legend>{t.groupLabel}</legend>
                    <div className={styles.chips}>
                      {groups.map((group) => (
                        <button
                          key={group.id}
                          type="button"
                          aria-pressed={groupId === group.id}
                          onClick={() => setGroupId(group.id)}
                        >
                          {group.name}
                        </button>
                      ))}
                    </div>
                    <label className={styles.due}>
                      <span>
                        {t.dueDate} <span className={styles.optional}>{t.optional}</span>
                      </span>
                      <input
                        type="date"
                        value={due}
                        min={localToday()}
                        onChange={(event) => setDue(event.target.value)}
                      />
                    </label>
                  </fieldset>

                  <fieldset className={styles.block}>
                    <legend>
                      {t.wordsToLearn} <span className={styles.optional}>{t.wordsPicked(picked.size)}</span>
                    </legend>
                    <div className={styles.chips}>
                      {shown.map((word) => (
                        <button
                          key={word.headword}
                          type="button"
                          lang="en"
                          aria-pressed={picked.has(word.headword)}
                          onClick={() => toggle(word.headword)}
                        >
                          {word.headword}
                        </button>
                      ))}
                    </div>
                    {!showAll && ordered.length > shown.length && (
                      <button type="button" className={styles.more} onClick={() => setShowAll(true)}>
                        {t.showMore} · {ordered.length - shown.length}
                      </button>
                    )}
                  </fieldset>

                  <fieldset className={styles.block}>
                    <legend>{t.questionsTitle}</legend>
                    <QuestionsEditor questions={questions} onChange={setQuestions} />
                  </fieldset>
                </>
              )}
              {problem && (
                <p className={styles.problem} role="alert">
                  {problem}
                </p>
              )}
              {groups && groups.length > 0 && (
                <PrimaryButton type="button" disabled={!groupId || busy} onClick={() => void give()}>
                  {t.giveToAGroup}
                </PrimaryButton>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
