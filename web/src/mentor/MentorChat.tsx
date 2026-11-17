import { useEffect, useRef, useState } from 'react';
import { ApiError, mentorChatStream } from '../lib/api.ts';
import { api } from '../lib/api.ts';
import type { Session } from '../lib/types.ts';
import { t, uiLanguage } from '../i18n/index.ts';
import { canDictate, dictate, type Dictation } from '../reading/dictation.ts';
import { study } from '../study/device.ts';
import { BackIcon, CopyIcon, MicIcon, SendIcon } from '../ui/icons.tsx';
import { MentorMarkdown } from './MentorMarkdown.tsx';
import type { PlanItem, Tip } from './types.ts';
import styles from './MentorChat.module.css';

const UI_LANG_BCP47: Record<string, string> = {
  ru: 'ru-RU',
  en: 'en-US',
  uz: 'uz-UZ',
  kk: 'kk-KZ',
  ky: 'ky-KG',
  tg: 'tg-TJ',
};

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  sentAt: Date;
}

function formatTime(d: Date): string {
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const MAX_LENGTH = 500;

const FALLBACK_SUGGESTIONS = [
  () => t.mentorChatSuggestion1,
  () => t.mentorChatSuggestion2,
  () => t.mentorChatSuggestion3,
];

function tipSuggestion(tip: Tip): (() => string) | null {
  switch (tip.id) {
    case 'firstRun':
      return () => t.mentorChatSuggestionFirstRun;
    case 'returner':
      return () => t.mentorChatSuggestionReturner(tip.days ?? 3);
    case 'allCaughtUp':
      return () => t.mentorChatSuggestionAllCaughtUp;
    case 'bigBacklog':
      return () => t.mentorChatSuggestionBacklog;
    default:
      return null;
  }
}

function suggestionsFor(items: readonly PlanItem[], tip: Tip): Array<() => string> {
  const chips: Array<() => string> = [];
  for (const item of items) {
    if (item.kind === 'vocab' && chips.length < 3) chips.push(() => t.mentorChatSuggestionVocab(item.title));
    else if (item.kind === 'spelling' && chips.length < 3) chips.push(() => t.mentorChatSuggestionSpelling(item.title));
    else if (item.kind === 'reading' && chips.length < 3) chips.push(() => t.mentorChatSuggestionReading(item.title));
  }
  const specific = chips.length === 0 ? tipSuggestion(tip) : null;
  const extra = specific ? [specific] : [];
  const fallbacks = FALLBACK_SUGGESTIONS.filter((_, i) => i >= chips.length + extra.length);
  return [...chips, ...extra, ...fallbacks].slice(0, 3);
}

const FOLLOW_UPS = [() => t.mentorChatFollowUp1, () => t.mentorChatFollowUp2, () => t.mentorChatFollowUp3];

function tipFollowUp(tip: Tip): (() => string) | null {
  switch (tip.id) {
    case 'firstRun':
      return () => t.mentorChatFollowUpFirstRun;
    case 'allCaughtUp':
      return () => t.mentorChatFollowUpAllCaughtUp;
    case 'returner':
      return () => t.mentorChatFollowUpReturner;
    default:
      return null;
  }
}

function followUpsFor(items: readonly PlanItem[], tip: Tip): Array<() => string> {
  const chips: Array<() => string> = [];
  for (const item of items) {
    if (item.kind === 'vocab' && chips.length < 1) chips.push(() => t.mentorChatFollowUpVocabTip);
    else if (item.kind === 'spelling' && chips.length < 1) chips.push(() => t.mentorChatFollowUpSpellingTip);
    else if (item.kind === 'reading' && chips.length < 1) chips.push(() => t.mentorChatFollowUpReadingTip);
  }
  const extra = chips.length < 2 ? (tipFollowUp(tip) ? [tipFollowUp(tip)!] : []) : [];
  return [...chips, ...extra, ...FOLLOW_UPS.filter((_, i) => i >= chips.length + extra.length)].slice(0, 3);
}

interface MentorChatProps {
  items?: readonly PlanItem[];
  tip: Tip;
  onBack: () => void;
  onOpenArticle: (articleId: string) => void;
  onStartSession: (session: Session, from: string) => void;
}

export function MentorChat({ items = [], tip, onBack, onOpenArticle, onStartSession }: MentorChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatsRemaining, setChatsRemaining] = useState<number | null>(null);
  const [chatsLimit, setChatsLimit] = useState<number | null>(null);
  const [listening, setListening] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const dictationRef = useRef<Dictation | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const historyPromise = api
      .mentorHistory()
      .then(({ messages: items }) => {
        setMessages(
          items.map((m) => ({
            role: m.role as 'user' | 'assistant',
            text: m.content,
            sentAt: new Date(m.created_at),
          })),
        );
      })
      .catch(() => {});
    const statusPromise = api
      .mentorStatus()
      .then(({ chats_remaining, chats_limit }) => {
        setChatsRemaining(chats_remaining);
        setChatsLimit(chats_limit);
      })
      .catch(() => undefined);
    void Promise.all([historyPromise, statusPromise]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    if (!listening) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') dictationRef.current?.stop();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [listening]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [draft]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    if (!navigator.onLine) {
      setError(t.mentorChatOffline);
      return;
    }
    setDraft('');
    setError(null);
    setSending(true);
    const userMsg: ChatMessage = { role: 'user', text: trimmed, sentAt: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    let streamStarted = false;
    try {
      let accumulated = '';
      const planPayload = items.map((item) =>
        item.kind === 'reading'
          ? { kind: 'reading' as const, title: item.title, minutes: item.minutes, level: item.level }
          : { kind: item.kind, title: item.title, count: item.count, minutes: item.minutes },
      );
      for await (const event of mentorChatStream(trimmed, planPayload, tip.id)) {
        if (event.delta) {
          accumulated += event.delta;
          if (!streamStarted) {
            streamStarted = true;
            setMessages((prev) => [...prev, { role: 'assistant', text: accumulated, sentAt: new Date() }]);
          } else {
            setMessages((prev) => {
              const msgs = [...prev];
              msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], text: accumulated };
              return msgs;
            });
          }
        }
        if (event.done) {
          setMessages((prev) => {
            const msgs = [...prev];
            msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], sentAt: new Date(event.created_at) };
            return msgs;
          });
          setChatsRemaining(event.chats_remaining);
        }
      }
    } catch (caught) {
      if (!streamStarted) {
        setMessages((prev) => prev.slice(0, -1));
        setDraft(trimmed);
      }
      if (caught instanceof ApiError && caught.code === 'mentor_chat_limit') {
        setError(t.mentorChatLimitReached);
      } else {
        setError(t.mentorChatUnavailable);
      }
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function clear() {
    dictationRef.current?.stop();
    setListening(false);
    setMessages([]);
    setDraft('');
    setError(null);
    void api.mentorClearHistory().catch(() => undefined);
  }

  function toggleVoice() {
    if (listening) {
      dictationRef.current?.stop();
      return;
    }
    const lang = UI_LANG_BCP47[uiLanguage] ?? 'ru-RU';
    setListening(true);
    const before = draft;
    dictationRef.current = dictate(
      (heard) => setDraft(before ? `${before} ${heard}` : heard),
      () => {
        setListening(false);
        dictationRef.current = null;
        inputRef.current?.focus();
      },
      lang,
    );
  }

  function copyMessage(text: string, index: number) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex((prev) => (prev === index ? null : prev)), 1500);
    });
  }

  async function launchItem(item: PlanItem) {
    if (actionBusy) return;
    if (item.kind === 'reading') {
      onOpenArticle(item.articleId);
      return;
    }
    setActionBusy(true);
    try {
      const session =
        item.kind === 'vocab'
          ? await study.startStudySession(item.deckId)
          : await study.startSpellingSession(item.deckId);
      onStartSession(session, item.deckId);
    } catch {
      // 409 = nothing left to study; ignore
    } finally {
      setActionBusy(false);
    }
  }

  const hasMessages = !loading && messages.length > 0;
  const lastIsAssistant = hasMessages && messages[messages.length - 1].role === 'assistant';
  const showFollowUps = lastIsAssistant && !sending;
  const showActions = items.length > 0 && !sending;

  const overLimit = draft.length > MAX_LENGTH;
  const nearLimit = !overLimit && draft.length >= Math.floor(MAX_LENGTH * 0.8);
  const canSend = draft.trim().length > 0 && !overLimit && !sending;

  return (
    <section className={styles.chat} aria-labelledby="mentor-chat-heading">
      {/* Header bar */}
      <div className={styles.chatHeader}>
        <button type="button" className={styles.backBtn} onClick={onBack} aria-label="Back">
          <BackIcon aria-hidden="true" />
        </button>
        <h2 className={styles.chatTitle} id="mentor-chat-heading">
          {t.mentorChatHeading}
        </h2>
        {hasMessages && (
          <button type="button" className={styles.clearBtn} onClick={clear}>
            {t.mentorChatClear}
          </button>
        )}
      </div>

      {loading && <div className={styles.loadingBar} aria-hidden="true" />}

      {/* Empty state — T3-style centered hero with greeting + suggestions */}
      {!loading && !hasMessages && (
        <div className={styles.heroEmpty}>
          <h1 className={styles.heroHeading}>{t.mentorChatHeading}</h1>
          <div className={styles.heroSuggestions}>
            {suggestionsFor(items, tip).map((s) => (
              <button key={s()} type="button" className={styles.heroChip} onClick={() => void send(s())}>
                {s()}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Message list */}
      {!loading && hasMessages && (
        <div
          ref={messagesRef}
          className={styles.messages}
          role="log"
          aria-live="polite"
          aria-label={t.mentorChatHeading}
        >
          {messages.map((msg, i) => (
            <div key={i} className={msg.role === 'user' ? styles.userWrap : styles.assistantWrap}>
              {msg.role === 'assistant' && <div className={styles.avatar} aria-hidden="true" />}
              {/* For assistant: wrap text + meta in a column so meta sits below the text */}
              <div className={msg.role === 'assistant' ? styles.assistantBody : undefined}>
                <div className={msg.role === 'user' ? styles.user : styles.assistant}>
                  {msg.role === 'user' ? msg.text : <MentorMarkdown text={msg.text} />}
                </div>
                <div className={styles.meta}>
                  <time className={styles.time} dateTime={msg.sentAt.toISOString()}>
                    {formatTime(msg.sentAt)}
                  </time>
                  {msg.role === 'assistant' && (
                    <button
                      type="button"
                      className={styles.copyBtn}
                      onClick={() => copyMessage(msg.text, i)}
                      aria-label={copiedIndex === i ? t.mentorChatCopied : t.mentorChatCopy}
                    >
                      {copiedIndex === i ? (
                        <span className={styles.copiedLabel}>{t.mentorChatCopied}</span>
                      ) : (
                        <CopyIcon aria-hidden="true" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {sending && messages[messages.length - 1]?.role === 'user' && (
            <div className={styles.typing} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Follow-up chips */}
      {showFollowUps && (
        <div className={styles.followUps}>
          {followUpsFor(items, tip).map((s) => (
            <button key={s()} type="button" className={styles.chip} onClick={() => void send(s())}>
              {s()}
            </button>
          ))}
        </div>
      )}

      {/* Plan action buttons */}
      {showActions && (
        <div className={styles.actionBar}>
          {items.map((item) => (
            <button
              key={item.kind === 'reading' ? item.articleId : item.deckId}
              type="button"
              className={styles.actionBtn}
              disabled={actionBusy}
              onClick={() => void launchItem(item)}
            >
              {item.kind === 'vocab' && t.mentorPlanVocabCta}
              {item.kind === 'spelling' && t.mentorPlanSpellingCta}
              {item.kind === 'reading' && t.mentorPlanReadingCta}{' '}
              <span className={styles.actionBtnLabel}>{item.title}</span>
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {/* Input bar */}
      <div className={styles.inputWrap}>
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
        >
          <textarea
            ref={inputRef}
            className={styles.input}
            placeholder={t.mentorChatPlaceholder}
            value={draft}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            aria-label={t.mentorChatPlaceholder}
            maxLength={MAX_LENGTH + 10}
          />
          <div className={styles.inputActions}>
            {canDictate() && (
              <button
                type="button"
                className={`${styles.mic} ${listening ? styles.micActive : ''}`}
                onClick={toggleVoice}
                aria-label={listening ? t.mentorChatVoiceStop : t.mentorChatVoiceStart}
                aria-pressed={listening}
              >
                <MicIcon aria-hidden="true" />
              </button>
            )}
            <button type="submit" className={styles.send} disabled={!canSend} aria-label={t.mentorChatSend}>
              <SendIcon aria-hidden="true" />
            </button>
          </div>
        </form>
        {overLimit && (
          <p className={styles.counter} role="status">
            {draft.length}/{MAX_LENGTH}
          </p>
        )}
        {nearLimit && (
          <p className={styles.counterSoft} role="status">
            {draft.length}/{MAX_LENGTH}
          </p>
        )}
        {!overLimit && !nearLimit && chatsRemaining !== null && chatsLimit !== null && (
          <p className={chatsRemaining <= 5 ? styles.lowCredit : styles.budget} role="status">
            {chatsRemaining <= 5
              ? t.mentorChatLowCredit(chatsRemaining)
              : t.mentorChatBudget(chatsRemaining, chatsLimit)}
          </p>
        )}
      </div>
    </section>
  );
}
