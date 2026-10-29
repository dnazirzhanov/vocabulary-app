import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Illustration, isIllustrationId } from '../illustrations/index.tsx';
import { api, describeError } from '../lib/api.ts';
import { autoplayEnabled, playAudio, preloadAudio, setAutoplay } from '../lib/audio.ts';
import { tokenize } from '../lib/tokens.ts';
import type { CardExercise, GlossaryEntry, Rating, Session, Summary } from '../lib/types.ts';
import { AlertIcon, CloseIcon, MuteIcon, SpeakerIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { formatInterval, reduceCardRun, remaining, startCardRun } from './cardRun.ts';
import { LessonProgress } from './LessonProgress.tsx';
import styles from './LessonScreen.module.css';
import { WordPopover } from './WordPopover.tsx';

interface LessonScreenProps {
  session: Session;
  onComplete: (summary: Summary) => void;
  /** Leaving is safe: every rating is already saved, and the session resumes from home. */
  onExit: () => void;
}

const RATINGS: { rating: Rating; label: string; tone: string }[] = [
  { rating: 1, label: 'Снова', tone: 'again' },
  { rating: 2, label: 'Трудно', tone: 'hard' },
  { rating: 3, label: 'Хорошо', tone: 'good' },
  { rating: 4, label: 'Легко', tone: 'easy' },
];

function ListenButton({ onPlay, label, small }: { onPlay: () => void; label: string; small?: boolean }) {
  return (
    <button
      type="button"
      className={small ? `${styles.listen} ${styles.listenSmall}` : styles.listen}
      onClick={onPlay}
      aria-label={label}
    >
      <SpeakerIcon />
    </button>
  );
}

type Tapped = { text: string; form: string; anchor: HTMLElement };

/** The example sentence, every word a button that opens its meaning; the card's word is marked. */
function TappableSentence({
  sentence,
  headword,
  onTap,
}: {
  sentence: string;
  headword: string;
  onTap: (t: Tapped) => void;
}) {
  const target = headword.toLowerCase();
  return (
    <>
      {tokenize(sentence).map((part, index) =>
        part.key ? (
          <button
            key={index}
            type="button"
            className={part.key === target ? `${styles.token} ${styles.highlight}` : styles.token}
            onClick={(event) => onTap({ text: part.text, form: part.key!, anchor: event.currentTarget })}
          >
            {part.text}
          </button>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** The card itself: the word on the front; translation, picture and example on the back. */
function Card({ card, revealed, onTap }: { card: CardExercise; revealed: boolean; onTap: (t: Tapped) => void }) {
  const { word } = card;
  return (
    <article className={styles.card} data-revealed={revealed || undefined} data-card={card.id}>
      <div className={styles.wordRow}>
        <h1 className={styles.word} lang="en" tabIndex={-1} data-autofocus>
          {word.headword}
        </h1>
        <ListenButton
          onPlay={() => void playAudio('words', word.id, word.headword)}
          label={`Послушать: ${word.headword}`}
        />
      </div>
      {revealed && (
        <div className={styles.back}>
          <p className={styles.translation}>{word.translation}</p>
          {isIllustrationId(word.illustration) && <Illustration id={word.illustration} className={styles.art} />}
          <div className={styles.example}>
            <p lang="en" className={styles.exampleEn}>
              <span>
                <TappableSentence sentence={word.example} headword={word.headword} onTap={onTap} />
              </span>
              <ListenButton
                small
                onPlay={() => void playAudio('examples', word.id, word.example)}
                label="Послушать пример"
              />
            </p>
            <p className={styles.exampleRu}>{word.example_ru}</p>
            <p className={styles.tapHint}>Нажмите на любое слово, чтобы увидеть перевод</p>
          </div>
        </div>
      )}
    </article>
  );
}

// One request per visit: the glossary is small and the same for every card.
let glossaryRequest: Promise<Record<string, GlossaryEntry>> | null = null;
const loadGlossary = () => (glossaryRequest ??= api.glossary().catch(() => ((glossaryRequest = null), {})));

export function LessonScreen({ session, onComplete, onExit }: LessonScreenProps) {
  const [state, dispatch] = useReducer(reduceCardRun, session, startCardRun);
  // While finishing, the last card stays on screen.
  const shownIndex = Math.min(state.index, state.cards.length - 1);
  const card = state.cards[shownIndex];
  const revealed = state.phase !== 'front';
  const mainRef = useRef<HTMLElement>(null);
  const inflight = useRef<string | null>(null);
  const [tapped, setTapped] = useState<Tapped | null>(null);
  const closeTapped = useCallback(() => setTapped(null), []);
  const [glossary, setGlossary] = useState<Record<string, GlossaryEntry>>({});
  const [autoplay, setAutoplayState] = useState(autoplayEnabled);
  useEffect(() => {
    void loadGlossary().then(setGlossary);
  }, []);

  // Each new card says its word, as soon as it appears (the learner can turn this off); the next
  // card's word is loaded meanwhile so it plays without a delay.
  useEffect(() => {
    if (state.phase !== 'front') return;
    if (autoplay) void playAudio('words', card.word.id, card.word.headword);
    const next = state.cards[state.index + 1];
    if (next) preloadAudio('words', next.word.id);
  }, [card.id, state.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Server round trips follow the phase; the ref keeps one request per step even when an effect
  // runs twice. The server's one-rating-per-showing rule is the real guarantee.
  useEffect(() => {
    if (state.phase === 'saving' && state.rating) {
      const current = state.cards[state.index];
      const key = `rate:${current.id}`;
      if (inflight.current === key) return;
      inflight.current = key;
      api
        .rateCard(session.id, current.id, state.rating)
        .then(
          (result) => dispatch({ type: 'saved', result }),
          (error: unknown) => dispatch({ type: 'failed', message: describeError(error) }),
        )
        .finally(() => {
          inflight.current = null;
        });
    }
    if (state.phase === 'finishing' && inflight.current !== 'finish') {
      inflight.current = 'finish';
      api
        .completeSession(session.id)
        .then(onComplete, (error: unknown) => dispatch({ type: 'failed', message: describeError(error) }))
        .finally(() => {
          inflight.current = null;
        });
    }
  }, [state, session.id, onComplete]);

  // Focus follows the flow: each new card's word, then the «Хорошо» button once revealed.
  useEffect(() => {
    if (state.phase === 'front') mainRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    if (state.phase === 'back') mainRef.current?.closest('div')?.querySelector<HTMLElement>('[data-default]')?.focus();
  }, [state.phase, state.index]);

  // Keyboard as in Anki: Space shows the answer, then Space means «Хорошо»; 1–4 rate.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.target as Element).closest('input, textarea, select, [role="dialog"]')) return;
      const number = Number(event.key);
      if (state.phase === 'front' && (event.key === ' ' || event.key === 'Enter')) {
        event.preventDefault();
        dispatch({ type: 'reveal' });
      } else if (state.phase === 'back' && number >= 1 && number <= 4) {
        dispatch({ type: 'rate', rating: number as Rating });
      } else if (state.phase === 'back' && event.key === ' ' && !(event.target as Element).closest('button')) {
        event.preventDefault();
        dispatch({ type: 'rate', rating: 3 });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state.phase]);

  const left = remaining(state);
  const previews = new Map(card.previews.map((preview) => [preview.rating, preview.seconds]));
  return (
    <div className={styles.screen}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <button type="button" className={styles.exit} onClick={onExit} aria-label="Выйти из урока">
            <CloseIcon />
          </button>
          <LessonProgress answered={state.results.length} total={state.cards.length} />
          <button
            type="button"
            className={styles.autoplay}
            aria-pressed={autoplay}
            aria-label="Произносить слово автоматически"
            title={autoplay ? 'Автозвук включён' : 'Автозвук выключен'}
            onClick={() => {
              setAutoplay(!autoplay);
              setAutoplayState(!autoplay);
            }}
          >
            {autoplay ? <SpeakerIcon /> : <MuteIcon />}
          </button>
          <p className={styles.counters} aria-label={`Осталось: новых ${left.fresh}, повторений ${left.review}`}>
            <span className={styles.countNew}>
              <strong>{left.fresh}</strong> нов.
            </span>
            <span className={styles.countReview}>
              <strong>{left.review}</strong> повт.
            </span>
          </p>
        </div>
      </header>

      <main ref={mainRef} className={styles.main}>
        <div key={card.id} className={styles.cardWrap}>
          <Card card={card} revealed={revealed} onTap={setTapped} />
        </div>
      </main>

      {tapped && (
        <WordPopover
          text={tapped.text}
          form={tapped.form}
          entry={glossary[tapped.form]}
          anchor={tapped.anchor}
          onClose={closeTapped}
        />
      )}

      <footer className={styles.bar}>
        <div className={styles.barInner}>
          {state.phase === 'error' ? (
            <div className={styles.problem} role="alert">
              <AlertIcon aria-hidden="true" />
              <span>{state.error}</span>
              <PrimaryButton type="button" onClick={() => dispatch({ type: 'retry' })}>
                Повторить
              </PrimaryButton>
            </div>
          ) : state.phase === 'front' ? (
            <PrimaryButton type="button" className={styles.reveal} onClick={() => dispatch({ type: 'reveal' })}>
              Показать ответ
            </PrimaryButton>
          ) : (
            <div className={styles.ratings} role="group" aria-label="Как хорошо вы вспомнили?">
              {RATINGS.map(({ rating, label, tone }) => (
                <button
                  key={rating}
                  type="button"
                  className={styles.rate}
                  data-tone={tone}
                  data-default={rating === 3 || undefined}
                  disabled={state.phase !== 'back'}
                  aria-busy={state.phase === 'saving' && state.rating === rating}
                  onClick={() => dispatch({ type: 'rate', rating })}
                >
                  <span className={styles.rateLabel}>{label}</span>
                  <span className={styles.rateWhen}>{formatInterval(previews.get(rating) ?? 0)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
