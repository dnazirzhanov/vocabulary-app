import { useEffect, useState } from 'react';
import { api, describeError } from '../lib/api.ts';
import type { GivenAnswers, ReadingAssignment } from '../lib/types.ts';
import { Dialog } from '../ui/Dialog.tsx';
import { CheckIcon, CloseIcon, ForwardIcon } from '../ui/icons.tsx';
import { t } from '../i18n/index.ts';
import styles from './Reading.module.css';

/**
 * «Ответы группы» for a reading given to a group (round 2, D2): each member with how many questions
 * they answered. Its giver and the group's owner also see how many were right, the words met, and
 * — a tap on a name — what each answered; they may take the reading back. Me first, then by name:
 * never a ranking.
 */
export function GroupAnswers({
  given,
  onClose,
  onTakenBack,
}: {
  given: ReadingAssignment;
  onClose: () => void;
  onTakenBack: () => void;
}) {
  const [answers, setAnswers] = useState<GivenAnswers | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.givenAnswers(given.id).then(
      (found) => live && setAnswers(found),
      (error: unknown) => live && setProblem(describeError(error)),
    );
    return () => {
      live = false;
    };
  }, [given.id]);

  const takeBack = () =>
    api.takeBackReading(given.id).then(onTakenBack, (error: unknown) => setProblem(describeError(error)));

  return (
    <Dialog open onClose={onClose} title={t.groupAnswers}>
      {!answers && !problem && <p className={styles.empty}>{t.loading}</p>}
      {answers && (
        <ul className={styles.memberList}>
          {answers.members.map((member, index) => {
            const parts = [
              member.answered > 0 ? t.answersOf(member.answered, answers.questions) : t.noAnswersYet,
              member.correct !== null && member.answered > 0 && answers.choice_questions > 0
                ? t.rightOf(member.correct, answers.choice_questions)
                : null,
              member.words_met !== null && answers.words > 0 ? t.wordsMetOf(member.words_met, answers.words) : null,
            ].filter(Boolean);
            const expandable = answers.may_see && member.answers.length > 0;
            return (
              <li key={`${member.name}-${index}`}>
                <button
                  type="button"
                  className={styles.member}
                  aria-expanded={expandable ? open === index : undefined}
                  disabled={!expandable}
                  onClick={() => setOpen(open === index ? null : index)}
                >
                  <span className={styles.memberText}>
                    <strong>{member.name ?? '—'}</strong>
                    <span>{parts.join(' · ')}</span>
                  </span>
                  {expandable && <ForwardIcon className={styles.memberChevron} aria-hidden="true" />}
                </button>
                {expandable && open === index && (
                  <ol className={styles.memberAnswers}>
                    {member.answers.map((answer) => (
                      <li key={answer.question_ref}>
                        <p className={styles.memberQuestion} lang="en">
                          {answer.question_text}
                        </p>
                        <p className={styles.memberAnswer} lang="en">
                          {answer.correct === true && <CheckIcon className={styles.rightMark} aria-label={t.correct} />}
                          {answer.correct === false && <CloseIcon className={styles.wrongMark} aria-label="✗" />}
                          {answer.text || t.noAnswer}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {problem && <p role="alert">{problem}</p>}
      {given.can_take_back &&
        (confirming ? (
          <div className={styles.confirm}>
            <p>{t.takeBackTheReading(given.title)}</p>
            <p className={styles.empty}>{t.takeBackNote}</p>
            <button type="button" className={styles.danger} onClick={() => void takeBack()}>
              {t.takeBackFromGroup}
            </button>
            <button type="button" className={styles.secondary} onClick={() => setConfirming(false)}>
              {t.cancel}
            </button>
          </div>
        ) : (
          <button type="button" className={styles.deleteText} onClick={() => setConfirming(true)}>
            {t.takeBackFromGroup}
          </button>
        ))}
    </Dialog>
  );
}
