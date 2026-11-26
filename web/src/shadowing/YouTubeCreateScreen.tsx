import { useMemo, useState, type FormEvent } from 'react';
import { t } from '../i18n/index.ts';
import { describeError } from '../lib/api.ts';
import { BackButton } from '../ui/BackButton.tsx';
import { CloseIcon } from '../ui/icons.tsx';
import { PrimaryButton } from '../ui/PrimaryButton.tsx';
import { checkYouTube, createYouTubeExercise, type ShadowingExercise, type YouTubeVideo } from './api.ts';
import { PauseIcon, PlayIcon } from './AudioPlayer.tsx';
import { clock } from './oneAtATime.ts';
import { mergeWithNext, parseTranscript, suggestedRange, toSentences, type Sentence } from './youtube/transcript.ts';
import { useYouTube } from './youtube/useYouTube.ts';
import styles from './YouTubeCreateScreen.module.css';

interface Props {
  onCreated: (exercise: ShadowingExercise) => void;
  onBack: () => void;
}

const LEVELS: ShadowingExercise['difficulty'][] = ['beginner', 'intermediate', 'advanced'];
/** As the server allows (ADR 0097). */
const MAX_CLIP_MS = 10 * 60 * 1000;

export function levelName(level: ShadowingExercise['difficulty']): string {
  if (level === 'beginner') return t.shadowingDifficultyBeginner;
  if (level === 'intermediate') return t.shadowingDifficultyIntermediate;
  return t.shadowingDifficultyAdvanced;
}

/**
 * A shadowing exercise from a YouTube video (ADR 0097), on one screen: the link, then the video's
 * text as copied from YouTube's «Show transcript», then the part to practise. Nothing is fetched
 * from YouTube but whether the video may be shown here and its title.
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
  const { ref, player, problem } = useYouTube(video?.youtube_id ?? null);

  const check = async (event: FormEvent) => {
    event.preventDefault();
    if (!link.trim() || checking) return;
    setChecking(true);
    setError(null);
    try {
      const found = await checkYouTube(link.trim());
      setVideo(found);
      setTitle(found.title.slice(0, 200));
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setChecking(false);
    }
  };

  const takeText = (text: string) => {
    setPasted(text);
    const made = toSentences(parseTranscript(text));
    setSentences(made);
    setRange(suggestedRange(made));
  };

  const readFile = (file: File | undefined) => {
    if (file) void file.text().then(takeText);
  };

  const [first, last] = range;
  const chosen = sentences.slice(first, last + 1);
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
    const s = sentences[index];
    void player.playSegment(s.start_ms, s.end_ms).then(() => setHearing((h) => (h === index ? null : h)));
  };

  const edit = (index: number, text: string) =>
    setSentences((all) => all.map((s, i) => (i === index ? { ...s, text } : s)));
  const merge = (index: number) => {
    setSentences((all) => mergeWithNext(all, index));
    setRange(([a, b]) => [a > index ? a - 1 : a, b > index ? b - 1 : b]);
  };
  const remove = (index: number) => {
    setSentences((all) => all.filter((_, i) => i !== index));
    setRange(([a, b]) => [a > index ? a - 1 : a, Math.max(b > index ? b - 1 : b, a > index ? a - 1 : a)]);
  };

  const options = useMemo(
    () =>
      sentences.map((s, i) => ({ value: i, label: `${i + 1}. ${clock(s.start_ms / 1000)} · ${s.text.slice(0, 40)}` })),
    [sentences],
  );

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
                  <textarea
                    className={styles.sentenceText}
                    rows={2}
                    maxLength={300}
                    aria-label={t.ytSentenceText(index + 1)}
                    value={s.text}
                    onChange={(event) => edit(index, event.target.value)}
                  />
                  <span className={styles.rowActions}>
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
