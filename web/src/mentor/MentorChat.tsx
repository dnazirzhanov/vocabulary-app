import { useEffect, useRef, useState } from 'react';
import { ApiError, mentorChatStream } from '../lib/api.ts';
import { api } from '../lib/api.ts';
import { t, uiLanguage } from '../i18n/index.ts';
import { canDictate, dictate, type Dictation } from '../reading/dictation.ts';
import { MicIcon, SendIcon } from '../ui/icons.tsx';
import { MentorGoal } from './MentorGoal.tsx';
import { MentorMarkdown } from './MentorMarkdown.tsx';
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
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const MAX_LENGTH = 500;

const SUGGESTIONS = [
  () => t.mentorChatSuggestion1,
  () => t.mentorChatSuggestion2,
  () => t.mentorChatSuggestion3,
] as const;

const FOLLOW_UPS = [() => t.mentorChatFollowUp1, () => t.mentorChatFollowUp2, () => t.mentorChatFollowUp3] as const;

export function MentorChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatsRemaining, setChatsRemaining] = useState<number | null>(null);
  const [listening, setListening] = useState(false);
  const dictationRef = useRef<Dictation | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
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
      .catch(() => {
        // History is best-effort; a network error just starts the chat fresh.
      })
      .finally(() => setLoading(false));
  }, []);

  // Auto-scroll only when the user is already near the bottom (within 80 px).
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Escape stops voice recording.
  useEffect(() => {
    if (!listening) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        dictationRef.current?.stop();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [listening]);

  // Auto-resize textarea as the user types.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [draft]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setDraft('');
    setError(null);
    setSending(true);
    const userMsg: ChatMessage = { role: 'user', text: trimmed, sentAt: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    let streamStarted = false;
    try {
      let accumulated = '';
      for await (const event of mentorChatStream(trimmed)) {
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
        // No chunks received yet — remove user message and restore draft so the user can retry.
        setMessages((prev) => prev.slice(0, -1));
        setDraft(trimmed);
      }
      // If streaming had started, keep the partial assistant text; just surface the error below.
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

  const hasMessages = !loading && messages.length > 0;
  // Show follow-up chips after the last assistant message, when not currently sending.
  const lastIsAssistant = hasMessages && messages[messages.length - 1].role === 'assistant';
  const showFollowUps = lastIsAssistant && !sending;

  const overLimit = draft.length > MAX_LENGTH;
  const canSend = draft.trim().length > 0 && !overLimit && !sending;

  return (
    <section className={styles.chat} aria-labelledby="mentor-chat-heading">
      <MentorGoal />
      <div className={styles.headingRow}>
        <h2 className={styles.heading} id="mentor-chat-heading">
          {t.mentorChatHeading}
        </h2>
        {hasMessages && (
          <button type="button" className={styles.clearBtn} onClick={clear}>
            {t.mentorChatClear}
          </button>
        )}
      </div>

      {loading && <div className={styles.loadingBar} aria-hidden="true" />}

      {!loading && !hasMessages && (
        <div className={styles.suggestions}>
          {SUGGESTIONS.map((s) => (
            <button key={s()} type="button" className={styles.chip} onClick={() => void send(s())}>
              {s()}
            </button>
          ))}
        </div>
      )}

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
              <div className={msg.role === 'user' ? styles.user : styles.assistant}>
                {msg.role === 'user' ? msg.text : <MentorMarkdown text={msg.text} />}
              </div>
              <time className={styles.time} dateTime={msg.sentAt.toISOString()}>
                {formatTime(msg.sentAt)}
              </time>
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

      {showFollowUps && (
        <div className={styles.followUps}>
          {FOLLOW_UPS.map((s) => (
            <button key={s()} type="button" className={styles.chip} onClick={() => void send(s())}>
              {s()}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

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
          <span className={styles.sendLabel}>{t.mentorChatSend}</span>
        </button>
      </form>
      {overLimit && (
        <p className={styles.counter} role="status">
          {draft.length}/{MAX_LENGTH}
        </p>
      )}
      {!overLimit && chatsRemaining !== null && chatsRemaining <= 5 && (
        <p className={styles.lowCredit} role="status">
          {t.mentorChatLowCredit(chatsRemaining)}
        </p>
      )}
    </section>
  );
}
