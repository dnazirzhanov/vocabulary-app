import { useMemo, useRef, useState, type FormEvent } from 'react';
import { t, uiLanguage } from '../i18n/index.ts';
import { describeError } from '../lib/api.ts';
import { BackButton } from '../ui/BackButton.tsx';
import { CloseIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import {
  checkYouTube,
  createYouTubeExercise,
  fetchTranscript,
  type ShadowingExercise,
  type YouTubeVideo,
} from './api.ts';
import { PauseIcon, PlayIcon } from './AudioPlayer.tsx';
import { clock } from './oneAtATime.ts';
import {
  alignWords,
  mergeWithNext,
  parseTranscript,
  rangeFrom,
  shiftTimes,
  splitAt,
  suggestedRange,
  toSentences,
  type Cue,
  type Sentence,
} from './youtube/transcript.ts';
import { useYouTube } from './youtube/useYouTube.ts';
import styles from './YouTubeCreateScreen.module.css';
import { levelName } from './levels.ts';

interface Props {
  onCreated: (exercise: ShadowingExercise) => void;
  onBack: () => void;
}

const LEVELS: ShadowingExercise['difficulty'][] = ['beginner', 'intermediate', 'advanced'];
/** As the server allows (ADR 0097). */
const MAX_CLIP_MS = 10 * 60 * 1000;
/** The «text earlier / later» step and limit. */
const SHIFT_STEP_MS = 100;
const MAX_SHIFT_MS = 2_000;
/** How long a part may be, in minutes; one minute to start with. */
const LENGTHS = [1, 2, 3, 5, 10];

/** Where the video's text came from: looked for by the server (ADR 0100), or pasted. */
type Found = 'looking' | 'manual' | 'auto' | 'none' | 'refused';

/**
 * A shadowing exercise from a YouTube video (ADR 0097), on one screen: the link, then the video's
 * text, then the part to practise. The server fetches the video's own captions (ADR 0100); when it
 * finds none, the learner pastes the text from YouTube's «Show transcript».
 */
export function YouTubeCreateScreen({ onCreated, onBack }: Props) {
  const [link, setLink] = useState('');
  const [video, setVideo] = useState<YouTubeVideo | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [title, setTitle] = useState('');
  const [level, setLevel] = useState<ShadowingExercise['difficulty']>('beginner');
  const [saving, setSaving] = useState(false);
  const [hearing, setHearing] = useState<number | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [pasteOwn, setPasteOwn] = useState(false);
  const [minutes, setMinutes] = useState(1);
  /** YouTube's recognised words for this video, when the server has them: the text's times. */
  const [heard, setHeard] = useState<Cue[] | null>(null);
  /** The whole text earlier (−) or later (+), for subtitles a little off from the sound. */
  const [shift, setShift] = useState(0);
  /** The sentence being split: its words are shown to tap where the new one starts. */
  const [splitting, setSplitting] = useState<number | null>(null);
  /** The video whose text is being looked for: an answer for an earlier link is dropped. */
  const lookingFor = useRef<string | null>(null);
  const { ref, player, problem } = useYouTube(video?.youtube_id ?? null);

  const check = async (event: FormEvent) => {
    event.preventDefault();
    if (!link.trim() || checking) return;
    setChecking(true);
    setError(null);
    try {
      const checked = await checkYouTube(link.trim());
      setVideo(checked);
      setTitle(checked.title.slice(0, 200));
      lookFor(checked.youtube_id);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setChecking(false);
    }
  };

  const takeCues = (cues: Cue[], words: Cue[] | null = heard) => {
    // The text on the recognised words' times, when there are any (ADR 0098 amendment).
    const made = toSentences(words ? alignWords(cues, words) : cues);
    setSentences(made);
    setShift(0);
    setSplitting(null);
    setRange(suggestedRange(made));
    setMinutes(1);
  };

  const lookFor = (youtubeId: string) => {
    lookingFor.current = youtubeId;
    setFound('looking');
    setPasteOwn(false);
    fetchTranscript(youtubeId).then(
      (transcript) => {
        if (lookingFor.current !== youtubeId) return;
        const words = transcript.words ?? null;
        setHeard(words);
        takeCues(transcript.cues, words);
        setFound(transcript.kind);
      },
      (error: unknown) => {
        if (lookingFor.current !== youtubeId) return;
        // «No captions» is the video; anything else (YouTube refusing the server, no
        // connection) may pass, so asking again is offered.
        const code = error instanceof Error && 'code' in error ? error.code : null;
        setFound(code === 'no_captions' ? 'none' : 'refused');
      },
    );
  };

  const takeText = (text: string) => {
    setPasted(text);
    takeCues(parseTranscript(text));
  };

  const readFile = (file: File | undefined) => {
    if (file) void file.text().then(takeText);
  };

  const [first, last] = range;
  const timed = useMemo(() => shiftTimes(sentences, shift), [sentences, shift]);
  const chosen = timed.slice(first, last + 1);
  const clipStart = chosen[0]?.start_ms ?? 0;
  const clipEnd = chosen.at(-1)?.end_ms ?? 0;
  const tooLong = clipEnd - clipStart > MAX_CLIP_MS;
  const noTimes = pasted.trim() !== '' && sentences.length === 0;

  const hear = (index: number) => {
    if (!player) return;
    if (hearing === index) {
      player.pause();
      setHearing(null);
      return;
    }
    setHearing(index);
    const s = timed[index];
    void player.playSegment(s.start_ms, s.end_ms).then(() => setHearing((h) => (h === index ? null : h)));
  };

  const edit = (index: number, text: string) =>
    setSentences((all) => all.map((s, i) => (i === index ? { ...s, text } : s)));
  const merge = (index: number) => {
    setSentences((all) => mergeWithNext(all, index));
    setRange(([a, b]) => [a > index ? a - 1 : a, b > index ? b - 1 : b]);
  };
  const split = (index: number, at: number) => {
    setSentences((all) => splitAt(all, index, at));
    setRange(([a, b]) => [a > index ? a + 1 : a, b >= index ? b + 1 : b]);
    setSplitting(null);
  };
  const nudge = (ms: number) => setShift((was) => Math.max(-MAX_SHIFT_MS, Math.min(MAX_SHIFT_MS, was + ms)));
  const remove = (index: number) => {
    setSentences((all) => all.filter((_, i) => i !== index));
    setRange(([a, b]) => [a > index ? a - 1 : a, Math.max(b > index ? b - 1 : b, a > index ? a - 1 : a)]);
  };

  const options = useMemo(
    () =>
      sentences.map((s, i) => ({ value: i, label: `${i + 1}. ${clock(s.start_ms / 1000)} · ${s.text.slice(0, 40)}` })),
    [sentences],
  );

  const minuteMarks = useMemo(
    () => Array.from({ length: Math.floor((sentences.at(-1)?.start_ms ?? 0) / 60_000) + 1 }, (_, m) => m),
    [sentences],
  );
  const startMinute = Math.floor((sentences[first]?.start_ms ?? 0) / 60_000);
  const startAt = (minute: number) => setRange(rangeFrom(sentences, minute * 60_000, minutes * 60_000));
  const lastFor = (length: number) => {
    setMinutes(length);
    setRange(rangeFrom(sentences, sentences[first]?.start_ms ?? 0, length * 60_000));
  };
  const pasting = found === 'none' || found === 'refused' || pasteOwn;

  const save = async () => {
    if (!video || chosen.length === 0 || tooLong || saving) return;
    const kept = chosen.map((s) => ({ ...s, text: s.text.trim() })).filter((s) => s.text);
    if (kept.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const made = await createYouTubeExercise({
        youtube_id: video.youtube_id,
        title: title.trim() || video.title.slice(0, 200) || 'YouTube',
        author: video.author.slice(0, 128),
        difficulty: level,
        clip_start_ms: clipStart,
        clip_end_ms: clipEnd,
        sentences: kept.map((s) => ({ ...s, text: s.text.slice(0, 300) })),
      });
      onCreated(made);
    } catch (caught) {
      setError(describeError(caught));
      setSaving(false);
    }
  };

  return (
    <main className={styles.screen}>
      <BackButton onClick={onBack} />
      <h1 className={styles.title}>{t.ytNewTitle}</h1>

      {/* 1. The link. */}
      <section className={styles.step} aria-labelledby="yt-step-link">
        <h2 id="yt-step-link" className={styles.stepTitle}>
          <span className={styles.stepNumber} aria-hidden="true">
            1
          </span>
          {t.ytStepLink}
        </h2>
        {video ? (
          <div className={styles.video}>
            <div className={styles.frame} ref={ref} />
            {problem && (
              <p role="alert" className={styles.error}>
                {problem === 'unreachable' ? t.ytNoConnection : t.ytVideoUnavailable}
              </p>
            )}
            <p className={styles.videoTitle}>
              <span>{video.title}</span>
              <span className={styles.meta}>{video.author}</span>
            </p>
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => {
                setVideo(null);
                setSentences([]);
                setPasted('');
                setFound(null);
                lookingFor.current = null;
              }}
            >
              {t.ytOtherLink}
            </button>
          </div>
        ) : (
          <form className={styles.linkForm} onSubmit={check}>
            <label className={styles.label} htmlFor="yt-link">
              {t.ytLinkLabel}
            </label>
            <div className={styles.linkRow}>
              <input
                id="yt-link"
                className={styles.input}
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://youtu.be/…"
                value={link}
                onChange={(event) => setLink(event.target.value)}
              />
              <PrimaryButton type="submit" disabled={!link.trim() || checking} aria-busy={checking}>
                {t.ytCheck}
              </PrimaryButton>
            </div>
          </form>
        )}
      </section>

      {/* 2. The text, copied from YouTube with its times. */}
      {video && (
        <section className={styles.step} aria-labelledby="yt-step-text">
          <h2 id="yt-step-text" className={styles.stepTitle}>
            <span className={styles.stepNumber} aria-hidden="true">
              2
            </span>
            {t.ytStepText}
          </h2>
          {found === 'looking' && (
            <p className={styles.looking} role="status">
              {t.ytLooking}
            </p>
          )}
          {(found === 'manual' || found === 'auto') && !pasteOwn && (
            <div className={styles.foundRow}>
              <p className={styles.found} role="status">
                {found === 'manual' ? t.ytFoundOwn : t.ytFoundAuto}
              </p>
              <button type="button" className={styles.linkButton} onClick={() => setPasteOwn(true)}>
                {t.ytPasteOwn}
              </button>
            </div>
          )}
          {found === 'none' && <p className={styles.meta}>{t.ytNotFound}</p>}
          {found === 'refused' && video && (
            <div className={styles.foundRow}>
              <p className={styles.meta}>{t.ytNotNow}</p>
              <button type="button" className={styles.linkButton} onClick={() => lookFor(video.youtube_id)}>
                {t.ytTryAgain}
              </button>
            </div>
          )}
          {pasting && (
            <>
              <details className={styles.how}>
                <summary>{t.ytHowToCopy}</summary>
                <ol>
                  <li>{t.ytHow1}</li>
                  <li>{t.ytHow2}</li>
                  <li>{t.ytHow3}</li>
                  <li>{t.ytHow4}</li>
                </ol>
              </details>
              <label className={styles.label} htmlFor="yt-text">
                {t.ytTextLabel}
              </label>
              <textarea
                id="yt-text"
                className={styles.textarea}
                rows={6}
                placeholder={'0:00\nGood morning, everyone.\n0:03\nToday we talk about food.'}
                value={pasted}
                onChange={(event) => takeText(event.target.value)}
              />
              <label className={styles.file}>
                {t.ytOrFile}
                <input
                  type="file"
                  accept=".srt,.vtt,.txt,text/plain,text/vtt"
                  onChange={(event) => readFile(event.target.files?.[0])}
                />
              </label>
              {noTimes && (
                <p role="alert" className={styles.error}>
                  {t.ytNoTimes}
                </p>
              )}
            </>
          )}
        </section>
      )}

      {/* 3. The part to practise, its sentences as they will be shown. */}
      {video && sentences.length > 0 && (
        <section className={styles.step} aria-labelledby="yt-step-part">
          <h2 id="yt-step-part" className={styles.stepTitle}>
            <span className={styles.stepNumber} aria-hidden="true">
              3
            </span>
            {t.ytStepPart}
          </h2>
          <div className={styles.range}>
            <label className={styles.label}>
              {t.ytStartAt}
              <select
                className={styles.select}
                value={startMinute}
                onChange={(event) => startAt(Number(event.target.value))}
              >
                {minuteMarks.map((m) => (
                  <option key={m} value={m}>
                    {clock(m * 60)}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.label}>
              {t.ytHowLong}
              <select
                className={styles.select}
                value={minutes}
                onChange={(event) => lastFor(Number(event.target.value))}
              >
                {LENGTHS.map((n) => (
                  <option key={n} value={n}>
                    {t.ytMinutes(n)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className={styles.range}>
            <label className={styles.label}>
              {t.ytFrom}
              <select
                className={styles.select}
                value={first}
                onChange={(event) => {
                  const a = Number(event.target.value);
                  setRange(([, b]) => [a, Math.max(a, b)]);
                }}
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.label}>
              {t.ytTo}
              <select
                className={styles.select}
                value={last}
                onChange={(event) => {
                  const b = Number(event.target.value);
                  setRange(([a]) => [Math.min(a, b), b]);
                }}
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className={tooLong ? styles.error : styles.meta} role={tooLong ? 'alert' : undefined}>
            {tooLong ? t.ytTooLong : t.ytChosen(chosen.length, clock((clipEnd - clipStart) / 1000))}
          </p>
          {/* Subtitles a little off from the sound: the whole text earlier or later, heard with ▶. */}
          <div className={styles.shift} role="group" aria-label={t.ytShift}>
            <span className={styles.label}>{t.ytShift}</span>
            <button
              type="button"
              className={styles.smallButton}
              disabled={shift <= -MAX_SHIFT_MS}
              onClick={() => nudge(-SHIFT_STEP_MS)}
            >
              {t.ytEarlier}
            </button>
            <output className={styles.shiftValue} aria-live="polite">
              {t.ytSeconds(
                (shift / 1000).toLocaleString(uiLanguage, { signDisplay: 'exceptZero', minimumFractionDigits: 1 }),
              )}
            </output>
            <button
              type="button"
              className={styles.smallButton}
              disabled={shift >= MAX_SHIFT_MS}
              onClick={() => nudge(SHIFT_STEP_MS)}
            >
              {t.ytLater}
            </button>
          </div>
          <ol className={styles.sentences} aria-label={t.ytSentences}>
            {chosen.map((s, offset) => {
              const index = first + offset;
              return (
                <li key={`${s.start_ms}-${index}`} className={styles.sentence}>
                  <button
                    type="button"
                    className={styles.hear}
                    disabled={!player}
                    aria-label={hearing === index ? t.ytStopListening : t.ytListen(index + 1)}
                    onClick={() => hear(index)}
                  >
                    {hearing === index ? <PauseIcon /> : <PlayIcon />}
                  </button>
                  <span className={styles.time}>{clock(s.start_ms / 1000)}</span>
                  {splitting === index ? (
                    <div className={styles.splitWords} role="group" aria-label={t.ytSplitHint}>
                      <p className={styles.splitHint}>{t.ytSplitHint}</p>
                      {s.text
                        .split(' ')
                        .filter(Boolean)
                        .map((word, at) => (
                          <button
                            key={`${word}-${at}`}
                            type="button"
                            className={styles.splitWord}
                            disabled={at === 0}
                            lang="en"
                            onClick={() => split(index, at)}
                          >
                            {word}
                          </button>
                        ))}
                    </div>
                  ) : (
                    <textarea
                      className={styles.sentenceText}
                      rows={2}
                      maxLength={300}
                      aria-label={t.ytSentenceText(index + 1)}
                      value={s.text}
                      onChange={(event) => edit(index, event.target.value)}
                    />
                  )}
                  <span className={styles.rowActions}>
                    {s.text.split(' ').filter(Boolean).length > 1 && (
                      <button
                        type="button"
                        className={styles.smallButton}
                        aria-pressed={splitting === index}
                        onClick={() => setSplitting((was) => (was === index ? null : index))}
                      >
                        {splitting === index ? t.ytSplitCancel : t.ytSplit}
                      </button>
                    )}
                    {index < sentences.length - 1 && (
                      <button type="button" className={styles.smallButton} onClick={() => merge(index)}>
                        {t.ytJoin}
                      </button>
                    )}
                    {sentences.length > 1 && (
                      <button
                        type="button"
                        className={styles.iconButton}
                        aria-label={t.ytRemoveSentence(index + 1)}
                        onClick={() => remove(index)}
                      >
                        <CloseIcon aria-hidden="true" />
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>

          <label className={styles.label} htmlFor="yt-title">
            {t.ytName}
          </label>
          <input
            id="yt-title"
            className={styles.input}
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <fieldset className={styles.levels}>
            <legend className={styles.label}>{t.ytLevel}</legend>
            {LEVELS.map((value) => (
              <label key={value} className={styles.level}>
                <input
                  type="radio"
                  name="yt-level"
                  value={value}
                  checked={level === value}
                  onChange={() => setLevel(value)}
                />
                <span>{levelName(value)}</span>
              </label>
            ))}
          </fieldset>
        </section>
      )}

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      {video && sentences.length > 0 && (
        <div className={styles.saveBar}>
          <PrimaryButton
            type="button"
            disabled={saving || tooLong || chosen.length === 0}
            aria-busy={saving}
            onClick={() => void save()}
          >
            {t.ytSave}
          </PrimaryButton>
        </div>
      )}
    </main>
  );
}
