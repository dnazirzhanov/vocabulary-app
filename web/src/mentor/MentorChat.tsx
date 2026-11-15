import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../lib/api.ts';
import { api } from '../lib/api.ts';
import { t } from '../i18n/index.ts';
import { SendIcon } from '../ui/icons.tsx';
import { MentorMarkdown } from './MentorMarkdown.tsx';
import styles from './MentorChat.module.css';

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
    try {
      const { reply, created_at, chats_remaining } = await api.mentorChat(trimmed);
      setMessages((prev) => [...prev, { role: 'assistant', text: reply, sentAt: new Date(created_at) }]);
      setChatsRemaining(chats_remaining);
    } catch (caught) {
      setMessages((prev) => prev.slice(0, -1));
      if (caught instanceof ApiError && caught.code === 'mentor_chat_limit') {
        setError(t.mentorChatLimitReached);
      } else {
        setError(t.mentorChatUnavailable);
      }
      setDraft(trimmed);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function clear() {
    setMessages([]);
    setDraft('');
    setError(null);
    // Best-effort: wipe server-side history so it doesn't reload on the next mount.
    void api.mentorClearHistory().catch(() => undefined);
  }

  const hasMessages = !loading && messages.length > 0;
  // Show follow-up chips after the last assistant message, when not currently sending.
  const lastIsAssistant = hasMessages && messages[messages.length - 1].role === 'assistant';
  const showFollowUps = lastIsAssistant && !sending;

  const overLimit = draft.length > MAX_LENGTH;
  const canSend = draft.trim().length > 0 && !overLimit && !sending;

  return (
    <section className={styles.chat} aria-labelledby="mentor-chat-heading">
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
          {sending && (
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
