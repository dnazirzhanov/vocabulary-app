import { useState, type CSSProperties, type ReactNode } from 'react';
import { t, uiLanguage } from '../i18n/index.ts';
import { PronunciationBreakdown } from './PronunciationBreakdown.tsx';
import { Recording } from './Recording.tsx';
import type { FeedbackItem, SpeakingAssessment, SpeakingQuestion, SpeakingSessionDetail } from './api.ts';
import { pausesOf, seconds, timeline } from './timeline.ts';
import styles from './EvaluationScreen.module.css';

interface EvaluationScreenProps {
  session: SpeakingSessionDetail;
  question: SpeakingQuestion;
  onBack: () => void;
}

type SkillKey = 'pronunciation' | 'fluency' | 'vocabulary' | 'grammar' | 'coherence';

const SKILLS: SkillKey[] = ['pronunciation', 'fluency', 'vocabulary', 'grammar', 'coherence'];
const label = (key: SkillKey) =>
  ({
    pronunciation: t.speakingSkillPronunciation,
    fluency: t.speakingSkillFluency,
    vocabulary: t.speakingSkillVocabulary,
    grammar: t.speakingSkillGrammar,
    coherence: t.speakingSkillCoherence,
  })[key];

/**
 * The feedback on one spoken answer: the overall score, then the five categories. Each opens to
 * its own facts and its own advice; nothing is repeated below them.
 */
export function EvaluationScreen({ session, question, onBack }: EvaluationScreenProps) {
  const a = session.assessment;
  const [open, setOpen] = useState<SkillKey | null>(null);

  return (
    <main className={styles.screen}>
      <button type="button" className={styles.back} onClick={onBack}>
        ‹ {t.speakingBack}
      </button>
      <h1 className={styles.title}>{t.speakingEvalHeading}</h1>
      <p className={styles.question}>
        {question.exercise_type === 'pronunciation' && question.reference_text
          ? `«${question.reference_text}»`
          : question.text}
      </p>

      {a && (
        <>
          <div className={styles.overall}>
            {a.overall_score !== null && (
              <span className={`${styles.overallScore} ${tone(a.overall_score)}`}>{Math.round(a.overall_score)}%</span>
            )}
            {length(a) && <span className={styles.length}>{length(a)}</span>}
          </div>
        </>
      )}

      {/* The recording plays even when scoring failed: it is still the learner's answer. */}
      {session.audio && (
        <div className={styles.recording}>
          <Recording sessionId={session.id} durationMs={session.audio.duration_ms} label={t.speakingYourRecording} />
        </div>
      )}

      {a && (
        <>
          <ul className={styles.skills}>
            {SKILLS.map((key) => {
              const score = a[`${key}_score`];
              const isOpen = open === key;
              return (
                <li key={key} className={styles.skill}>
                  <button
                    type="button"
                    className={styles.skillRow}
                    onClick={() => setOpen(isOpen ? null : key)}
                    aria-expanded={isOpen}
                  >
                    <span className={styles.skillName}>{label(key)}</span>
                    <span className={`${styles.skillScore} ${score === null ? styles.none : tone(score)}`}>
                      {score === null ? '—' : `${Math.round(score)}%`}
                    </span>
                    <span className={styles.chevron} aria-hidden="true">
                      {isOpen ? '▾' : '▸'}
                    </span>
                  </button>
                  {isOpen && <div className={styles.detail}>{detail(key, a)}</div>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </main>
  );
}

function tone(score: number): string {
  if (score >= 75) return styles.good;
  if (score >= 50) return styles.mid;
  return styles.low;
}

function length(a: SpeakingAssessment): string | null {
  const whisper = a.evidence.whisper as { duration_s?: number } | undefined;
  if (!whisper?.duration_s) return null;
  const total = Math.round(whisper.duration_s); // 119.9 s is «2:00», not «1:60»
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Why a category has no score, from what the server recorded. */
function missing(evidence: unknown): string {
  const skipped = (evidence as { skipped?: string } | undefined)?.skipped ?? '';
  if (skipped === 'read_aloud') return t.speakingEvalReadAloud;
  if (skipped.startsWith('error')) return t.speakingEvalFailed;
  return t.speakingEvalInsufficientData;
}

function detail(key: SkillKey, a: SpeakingAssessment): ReactNode {
  const items = a.feedback_items.filter((i) => i.category === key);
  const ev = a.evidence[key === 'pronunciation' ? 'azure_pa' : key];
  if (a[`${key}_score`] === null && items.length === 0) return <p className={styles.note}>{missing(ev)}</p>;
  return (
    <>
      {key === 'pronunciation' && a.pronunciation_words.length > 0 && (
        <PronunciationBreakdown words={a.pronunciation_words} pronunciationScore={a.pronunciation_score} />
      )}
      {key === 'fluency' && <Fluency a={a} />}
      {key === 'vocabulary' && <Vocabulary evidence={ev} />}
      {key === 'grammar' && items.length === 0 && a.grammar_score !== null && (
        <p className={styles.note}>{t.speakingEvalNoErrors}</p>
      )}
      {key === 'coherence' && <Justification evidence={ev} />}
      <Items items={items} />
    </>
  );
}

function Fluency({ a }: { a: SpeakingAssessment }) {
  const f = (a.evidence.fluency ?? {}) as Record<string, unknown>;
  const num = (k: string) => (typeof f[k] === 'number' ? (f[k] as number) : null);
  const wpm = num('wpm');
  const pauses = num('silent_pauses') ?? num('pause_count');
  const inside = num('pauses_inside_phrase');
  const fillers = num('filled_pauses') ?? num('filler_count');
  const run = num('mean_run_words');
  const pieces = timeline(a.transcript_words, pausesOf(f));
  return (
    <>
      <dl className={styles.facts}>
        {wpm !== null && <Fact name={t.speakingEvalRate} value={`${Math.round(wpm)} ${t.speakingEvalWpm}`} />}
        {pauses !== null && (
          <Fact
            name={t.speakingEvalPauses}
            value={inside ? `${pauses} (${t.speakingEvalInsidePhrase}: ${inside})` : `${pauses}`}
          />
        )}
        {fillers !== null && <Fact name={t.speakingEvalFillers} value={`${fillers}`} />}
        {run !== null && <Fact name={t.speakingEvalRun} value={`${run}`} />}
      </dl>
      {pieces.length > 0 && (
        <section className={styles.spoken} aria-label={t.speakingEvalYourAnswer}>
          <h3 className={styles.subhead}>{t.speakingEvalYourAnswer}</h3>
          <p className={styles.transcript} lang="en">
            {pieces.map((p, i) =>
              p.kind === 'word' ? (
                <span key={i}>{p.text} </span>
              ) : p.kind === 'filler' ? (
                <span key={i} className={styles.filler}>
                  {p.text || t.speakingEvalFillerMark}
                </span>
              ) : (
                <span
                  key={i}
                  className={p.inside ? styles.pauseInside : styles.pause}
                  title={t.speakingEvalPause(seconds(p.ms, uiLanguage))}
                  aria-label={t.speakingEvalPause(seconds(p.ms, uiLanguage))}
                >
                  ‖ {seconds(p.ms, uiLanguage)}
                </span>
              ),
            )}
          </p>
        </section>
      )}
    </>
  );
}

function Fact({ name, value }: { name: string; value: string }) {
  return (
    <div className={styles.fact}>
      <dt>{name}</dt>
      <dd>{value}</dd>
    </div>
  );
}

interface VocabEvidence {
  profile?: Record<string, number>;
  mattr?: number;
  repeated?: string[];
  evidence?: {
    misused?: { quote: string; better: string; why?: string }[];
    overused?: { quote: string; alternatives: string[]; why?: string }[];
    strong?: { quote: string; why?: string }[];
  };
}

const BANDS = ['A1-A2', 'B1', 'B2', 'C1+'] as const;

function Vocabulary({ evidence }: { evidence: unknown }) {
  const v = (evidence ?? {}) as VocabEvidence;
  const profile = v.profile;
  const misused = v.evidence?.misused ?? [];
  const overused = v.evidence?.overused ?? [];
  const strong = v.evidence?.strong ?? [];
  // Without the model's evidence, the plain count of repeated words still helps.
  const repeated = overused.length === 0 ? (v.repeated ?? []) : [];
  return (
    <>
      {profile && (
        <div className={styles.levels}>
          <h3 className={styles.subhead}>{t.speakingEvalLevels}</h3>
          <div
            className={styles.levelBar}
            role="img"
            aria-label={BANDS.map((b) => `${b} ${pct(profile[b])}`).join(', ')}
          >
            {BANDS.map((b) =>
              profile[b] ? (
                <span
                  key={b}
                  className={styles[`band${b.replace(/\W/g, '')}`]}
                  style={{ '--share': profile[b] } as CSSProperties}
                />
              ) : null,
            )}
          </div>
          <ul className={styles.levelKey}>
            {BANDS.map((b) => (
              <li key={b}>
                <i className={styles[`band${b.replace(/\W/g, '')}`]} aria-hidden="true" />
                {b} <strong>{pct(profile[b])}</strong>
              </li>
            ))}
          </ul>
          {typeof v.mattr === 'number' && (
            <dl className={styles.facts}>
              <Fact name={t.speakingEvalVariety} value={pct(v.mattr)} />
            </dl>
          )}
        </div>
      )}
      {misused.length > 0 && (
        <Group title={t.speakingEvalMisused}>
          {misused.map((m, i) => (
            <li key={i}>
              <p className={styles.fixLine} lang="en">
                <del>{m.quote}</del> <ins>{m.better}</ins>
              </p>
              {m.why && <p className={styles.why}>{m.why}</p>}
            </li>
          ))}
        </Group>
      )}
      {(overused.length > 0 || repeated.length > 0) && (
        <Group title={t.speakingEvalOverused}>
          {overused.map((o, i) => (
            <li key={i}>
              <p className={styles.fixLine} lang="en">
                <strong>{o.quote}</strong> → {o.alternatives.join(', ')}
              </p>
              {o.why && <p className={styles.why}>{o.why}</p>}
            </li>
          ))}
          {repeated.map((w) => (
            <li key={w}>
              <p className={styles.fixLine} lang="en">
                <strong>{w}</strong>
              </p>
            </li>
          ))}
        </Group>
      )}
      {strong.length > 0 && (
        <Group title={t.speakingEvalStrong}>
          {strong.map((s, i) => (
            <li key={i}>
              <p className={styles.fixLine} lang="en">
                <ins>{s.quote}</ins>
              </p>
              {s.why && <p className={styles.why}>{s.why}</p>}
            </li>
          ))}
        </Group>
      )}
    </>
  );
}

const pct = (share: number | undefined) => `${Math.round((share ?? 0) * 100)}%`;

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.group}>
      <h3 className={styles.subhead}>{title}</h3>
      <ul className={styles.list}>{children}</ul>
    </section>
  );
}

function Justification({ evidence }: { evidence: unknown }) {
  const text = (evidence as { justification?: string } | undefined)?.justification;
  return text ? (
    <p className={styles.text} lang="en">
      {text}
    </p>
  ) : null;
}

/** The category's own advice: what was said, the better way, and why. */
function Items({ items }: { items: FeedbackItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className={styles.list}>
      {items.map((item, i) => (
        <li key={i}>
          {(item.original_text || item.corrected_text) && (
            <p className={styles.fixLine} lang="en">
              {item.original_text && <del>{item.original_text}</del>}{' '}
              {item.corrected_text && <ins>{item.corrected_text}</ins>}
            </p>
          )}
          {item.explanation && (
            <p className={item.original_text || item.corrected_text ? styles.why : styles.text} lang="en">
              {item.explanation}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
