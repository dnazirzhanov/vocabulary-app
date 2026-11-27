/**
 * A question whose words can be tapped for their meaning (ADR 0091), as in Reading: a Writing or
 * Speaking prompt, or a shadowing sentence (ADR 0099). The meanings load on the first tap (the server keeps them per question and
 * language) and show in the lesson's word card, with its «listen». Each word is a button, so the
 * keyboard reaches it too.
 */
import { useCallback, useState } from 'react';
import { request } from '../lib/api.ts';
import type { GlossaryEntry } from '../lib/types.ts';
import { pieces } from '../reading/text.ts';
import { WordPopover } from '../lesson/WordPopover.tsx';
import styles from './TappableText.module.css';

type Meaning = { l: string | null; p: string | null; t: string; d: string | null };
type Kind = 'writing' | 'speaking' | 'shadowing';

// One question's meanings for this visit: a second tap, or a second screen, asks nothing more.
const loaded = new Map<string, Promise<Record<string, Meaning>>>();

function meaningsOf(kind: Kind, questionId: string): Promise<Record<string, Meaning>> {
  const key = `${kind}:${questionId}`;
  let found = loaded.get(key);
  if (!found) {
    found = request<{ glossary: Record<string, Meaning> }>('GET', `/prompt-glossary/${kind}/${questionId}`).then(
      (got) => got.glossary,
    );
    // A failure is forgotten, so a later tap tries again.
    found.catch(() => loaded.delete(key));
    loaded.set(key, found);
  }
  return found;
}

/** The text's pieces, each word with its place among the words. */
function numbered(text: string) {
  let word = -1;
  return pieces(text).map((piece) => ({ piece, word: piece.key ? ++word : word }));
}

interface Tapped {
  text: string;
  form: string;
  anchor: HTMLElement;
  entry: GlossaryEntry | undefined;
}

export function TappableText({
  text,
  kind,
  questionId,
  className,
  as: Tag = 'p',
  marked = 0,
  markClassName,
}: {
  text: string;
  kind: Kind;
  questionId: string;
  className?: string;
  as?: 'p' | 'h1' | 'h2';
  /** The first this many words carry `markClassName`: shadowing lights them up as they are said. */
  marked?: number;
  markClassName?: string;
}) {
  const [tapped, setTapped] = useState<Tapped | null>(null);
  const close = useCallback(() => setTapped(null), []);

  const open = (word: string, form: string, anchor: HTMLElement) => {
    setTapped({ text: word, form, anchor, entry: undefined });
    meaningsOf(kind, questionId).then(
      (glossary) => {
        const m = glossary[form];
        const entry = m ? { ru: m.t, lemma: m.l, note: m.d } : undefined;
        setTapped((now) => (now && now.form === form ? { ...now, entry } : now));
      },
      () => undefined, // the card keeps saying the translation will come; a later tap retries
    );
  };

  return (
    <>
      <Tag className={className} lang="en">
        {numbered(text).map(({ piece, word }, i) =>
          piece.key ? (
            <button
              key={i}
              type="button"
              className={word < marked && markClassName ? `${styles.word} ${markClassName}` : styles.word}
              aria-expanded={tapped?.anchor !== undefined && tapped.form === piece.key}
              onClick={(e) => open(piece.text, piece.key!, e.currentTarget)}
            >
              {piece.text}
            </button>
          ) : (
            <span key={i}>{piece.text}</span>
          ),
        )}
      </Tag>
      {tapped && (
        <WordPopover
          text={tapped.text}
          form={tapped.form}
          entry={tapped.entry}
          anchor={tapped.anchor}
          onClose={close}
        />
      )}
    </>
  );
}
