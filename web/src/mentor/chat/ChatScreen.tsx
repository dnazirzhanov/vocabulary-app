/**
 * The mentor's chat (ADR 0072), laid out like T3 Chat in the app's own look: chats in a sidebar
 * (a drawer on phones) with «Новый чат»; a new chat opens on a greeting and four ways in; the
 * learner's messages are bubbles on the right, the mentor's answers plain text on the page, with
 * the mentor's tool steps and cards above them; a rounded composer is pinned at the bottom.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  api,
  ApiError,
  mentorChatStream,
  type MentorConversation,
  type MentorPlanItem,
  type MentorToolEvent,
} from '../../lib/api.ts';
import { t, uiLanguage } from '../../i18n/index.ts';
import { canDictate, dictate, type Dictation } from '../../reading/dictation.ts';
import {
  BackIcon,
  CalendarIcon,
  CheckIcon,
  CopyIcon,
  MicIcon,
  MoreIcon,
  PencilIcon,
  PlusIcon,
  RepeatIcon,
  SendIcon,
  SparkleIcon,
  TrashIcon,
} from '../../ui/icons.tsx';
import { Dialog } from '../../ui/Dialog.tsx';
import { MentorMarkdown } from '../MentorMarkdown.tsx';
import { grouped, messageTime, titleOf, type ChatGroup } from './format.ts';
import { ToolCard, ToolStep, type Activity } from './ToolCards.tsx';
import { CardSkeleton, PlanPanel } from './GenCards.tsx';
import styles from './Chat.module.css';

const MAX_LENGTH = 500;
// Voice input listens in the app's language.
const SPEECH_LANG: Record<string, string> = {
  ru: 'ru-RU',
  en: 'en-US',
  ky: 'ky-KG',
  kk: 'kk-KZ',
  uz: 'uz-UZ',
  tg: 'tg-TJ',
};

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  sentAt: Date;
  steps: MentorToolEvent[];
}

interface ChatScreenProps {
  name: string | null;
  /** Today's tasks, as the home made them: sent with each message for the mentor's tools. */
  plan: MentorPlanItem[];
  tipId?: string;
  /** A first question to send at once (from the home's «Спросить наставника» or a chip). */
  ask?: string | null;
  onBack: () => void;
  /** Starts an activity from a card in the chat, or from the plan beside it. */
  onStart: (activity: Activity, where?: 'chat' | 'panel') => Promise<void> | void;
  onOpenCalendar: () => void;
  onOpenMemory: () => void;
  /** Today's plan, the mentor's page of the day. */
  onOpenToday: () => void;
  /** Whose device memory keeps the last open chat. */
  account: string;
}

const GROUP_LABEL: Record<ChatGroup, () => string> = {
  today: () => t.mentorChatToday,
  yesterday: () => t.mentorChatYesterday,
  week: () => t.mentorChatThisWeek,
  earlier: () => t.mentorChatEarlier,
};

export function ChatScreen({
  name,
  plan,
  tipId,
  ask,
  onBack,
  onStart,
  onOpenCalendar,
  onOpenMemory,
  onOpenToday,
  account,
}: ChatScreenProps) {
  const [chats, setChats] = useState<MentorConversation[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [menuFor, setMenuFor] = useState<MentorConversation | null>(null);
  const [renaming, setRenaming] = useState('');
  // The chat whose deletion is being confirmed (kept apart from the menu, which closes first).
  const [deleting, setDeleting] = useState<MentorConversation | null>(null);
  const [listening, setListening] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const dictation = useRef<Dictation | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const asked = useRef(false);
  // Set by the first message sent here: from then on, the chat list arriving late must not
  // reopen the last chat over the answer being streamed.
  const sentHere = useRef(false);
  // Each answer being streamed owns a token; switching chats retires it, so a late word never
  // lands in another chat (the server still saves it in its own).
  const streamToken = useRef(0);

  // A new question always brings its answer into view; then the answer is followed as it
  // streams, unless the learner scrolled up to read.
  const shown = useRef(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const asked = turns.length > shown.current;
    shown.current = turns.length;
    if (asked || el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [turns]);

  useEffect(() => {
    if (!drawer) return;
    const close = (event: globalThis.KeyboardEvent) => event.key === 'Escape' && setDrawer(false);
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [drawer]);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  const open = async (id: string | null) => {
    const token = ++streamToken.current;
    setSending(false);
    setDrawer(false);
    setError(null);
    setActive(id);
    setTurns([]);
    if (!id) return;
    try {
      const messages = await api.mentorConversationMessages(id);
      // A question sent, or another chat opened, while these loaded: they are out of date.
      if (streamToken.current !== token) return;
      setTurns(
        messages.map((m) => ({
          role: m.role,
          text: m.content,
          sentAt: new Date(m.created_at),
          steps: m.parts.map((p, i) => ({ id: `saved-${i}`, name: p.name, status: 'done', card: p.card })),
        })),
      );
    } catch {
      if (streamToken.current === token) setError(t.mentorChatUnavailable);
    }
  };

  // The chats, and coming back to the mentor opens the one it was left in (unless a question
  // was brought along).
  useEffect(() => {
    void api.mentorConversations().then(
      (list) => {
        // A chat begun before the list arrived stays on top of it.
        setChats((was) => [...was.filter((c) => !list.some((l) => l.id === c.id)), ...list]);
        const last = ask || sentHere.current ? null : readLastChat(account);
        if (last && list.some((c) => c.id === last)) void open(last);
      },
      () => undefined,
    );
    // Once, when the chat screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (active) writeLastChat(account, active);
  }, [active, account]);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || sending || message.length > MAX_LENGTH) return;
      if (!navigator.onLine) {
        setError(t.mentorChatOffline);
        return;
      }
      setDraft('');
      setError(null);
      setSending(true);
      sentHere.current = true;
      const token = ++streamToken.current;
      const now = new Date();
      setTurns((was) => [
        ...was,
        { role: 'user', text: message, sentAt: now, steps: [] },
        { role: 'assistant', text: '', sentAt: now, steps: [] },
      ]);
      const update = (change: (turn: Turn) => Turn) =>
        setTurns((was) =>
          was.length === 0 || streamToken.current !== token ? was : [...was.slice(0, -1), change(was[was.length - 1])],
        );
      let started = false;
      try {
        for await (const event of mentorChatStream(message, plan, tipId, {
          conversationId: active,
          newConversation: active === null,
        })) {
          if (streamToken.current !== token) {
            // The learner moved to another chat: keep the list in order, change nothing on screen.
            if (event.conversation) {
              const { id, title } = event.conversation;
              setChats((was) => [
                { id, title: title || titleOf(message), updated_at: new Date().toISOString() },
                ...was.filter((c) => c.id !== id),
              ]);
            }
            continue;
          }
          if (event.conversation) {
            const { id, title } = event.conversation;
            setActive(id);
            setChats((was) => [
              { id, title: title || titleOf(message), updated_at: new Date().toISOString() },
              ...was.filter((c) => c.id !== id),
            ]);
          } else if (event.tool) {
            started = true;
            const step = event.tool;
            update((turn) => ({
              ...turn,
              steps: turn.steps.some((s) => s.id === step.id)
                ? turn.steps.map((s) => (s.id === step.id ? step : s))
                : [...turn.steps, step],
            }));
          } else if (event.delta) {
            started = true;
            const delta = event.delta;
            update((turn) => ({ ...turn, text: turn.text + delta }));
          } else if (event.done) {
            update((turn) => ({ ...turn, sentAt: new Date(event.created_at) }));
          }
        }
      } catch (caught) {
        if (streamToken.current !== token) return;
        if (!started) {
          setTurns((was) => was.slice(0, -2));
          setDraft(message);
        }
        setError(
          caught instanceof ApiError && caught.code === 'mentor_chat_limit'
            ? t.mentorChatLimitReached
            : t.mentorChatUnavailable,
        );
      } finally {
        if (streamToken.current === token) {
          setSending(false);
          input.current?.focus();
        }
      }
    },
    [active, plan, sending, tipId],
  );

  // A question handed over from the home goes at once, into a new chat.
  useEffect(() => {
    if (ask && !asked.current) {
      asked.current = true;
      void send(ask);
    }
  }, [ask, send]);

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send(draft);
    }
  };

  const toggleVoice = () => {
    if (listening) {
      dictation.current?.stop();
      return;
    }
    setListening(true);
    const before = draft;
    dictation.current = dictate(
      (heard) => setDraft(before ? `${before} ${heard}` : heard),
      () => {
        setListening(false);
        dictation.current = null;
        input.current?.focus();
      },
      SPEECH_LANG[uiLanguage] ?? 'ru-RU',
    );
  };

  const retry = (index: number) => {
    const question = turns[index - 1];
    if (question?.role !== 'user') return;
    setTurns((was) => was.slice(0, index - 1));
    void send(question.text);
  };

  const rename = async () => {
    if (!menuFor || !renaming.trim()) return;
    const saved = await api.mentorRenameConversation(menuFor.id, renaming.trim()).catch(() => null);
    if (saved) setChats((was) => was.map((c) => (c.id === saved.id ? { ...c, title: saved.title } : c)));
    setMenuFor(null);
  };

  const remove = async () => {
    const chat = deleting;
    if (!chat) return;
    await api.mentorDeleteConversation(chat.id).catch(() => undefined);
    setChats((was) => was.filter((c) => c.id !== chat.id));
    if (active === chat.id) void open(null);
    setDeleting(null);
  };

  const now = new Date();
  const title = chats.find((c) => c.id === active)?.title ?? t.mentorNewChat;
  const empty = turns.length === 0;
  const starters = [
    { label: t.mentorAskNow, icon: <SparkleIcon /> },
    { label: t.mentorAskWeek, icon: <CalendarIcon /> },
    { label: t.mentorAskGoal, icon: <PencilIcon /> },
    { label: t.mentorAskSchedule, icon: <CalendarIcon /> },
  ];

  return (
    <div className={styles.layout} data-drawer={drawer || undefined}>
      <aside className={styles.sidebar} aria-label={t.mentorChats}>
        <div className={styles.sidebarHead}>
          <button type="button" className={styles.iconButton} onClick={onBack} aria-label={t.back}>
            <BackIcon aria-hidden="true" />
          </button>
          <span className={styles.sidebarTitle}>{t.mentorTitle}</span>
        </div>
        <button type="button" className={styles.newChat} onClick={() => void open(null)}>
          <PlusIcon aria-hidden="true" /> {t.mentorNewChat}
        </button>
        <nav className={styles.threads}>
          {grouped(chats, now).map(([group, list]) => (
            <section key={group} aria-label={GROUP_LABEL[group]()}>
              <h2 className={styles.groupTitle}>{GROUP_LABEL[group]()}</h2>
              <ul>
                {list.map((chat) => (
                  <li key={chat.id} className={styles.thread} data-active={chat.id === active || undefined}>
                    <button
                      type="button"
                      className={styles.threadOpen}
                      aria-current={chat.id === active ? 'page' : undefined}
                      onClick={() => void open(chat.id)}
                    >
                      {chat.title}
                    </button>
                    <button
                      type="button"
                      className={styles.threadMore}
                      aria-label={t.mentorChatActions(chat.title)}
                      onClick={() => {
                        setMenuFor(chat);
                        setRenaming(chat.title);
                      }}
                    >
                      <MoreIcon aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
        <button type="button" className={styles.calendarLink} onClick={onOpenToday}>
          <CheckIcon aria-hidden="true" /> {t.mentorPlanHeading}
        </button>
        <button type="button" className={styles.calendarLink} onClick={onOpenMemory}>
          <SparkleIcon aria-hidden="true" /> {t.memoryTitle}
        </button>
        <button type="button" className={styles.calendarLink} onClick={onOpenCalendar}>
          <CalendarIcon aria-hidden="true" /> {t.scheduleHeading}
        </button>
      </aside>
      {drawer && (
        <button type="button" className={styles.scrim} aria-label={t.close} onClick={() => setDrawer(false)} />
      )}

      <section className={styles.main} aria-label={title}>
        <header className={styles.header}>
          <button
            type="button"
            className={`${styles.iconButton} ${styles.drawerButton}`}
            aria-label={t.mentorChats}
            aria-expanded={drawer}
            onClick={() => setDrawer(true)}
          >
            <span className={styles.hamburger} aria-hidden="true" />
          </button>
          <h1 className={styles.headerTitle}>{empty ? t.mentorTitle : title}</h1>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={t.mentorNewChat}
            onClick={() => void open(null)}
          >
            <PlusIcon aria-hidden="true" />
          </button>
        </header>

        <div ref={scroller} className={styles.scroll}>
          {empty ? (
            <div className={styles.empty}>
              <h2 className={styles.hello}>{name ? t.mentorHello(name) : t.mentorHelloNoName}</h2>
              <ul className={styles.starters}>
                {starters.map((s) => (
                  <li key={s.label}>
                    <button type="button" className={styles.starter} onClick={() => void send(s.label)}>
                      <span aria-hidden="true">{s.icon}</span>
                      {s.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ol className={styles.turns}>
              {turns.map((turn, i) =>
                turn.role === 'user' ? (
                  <li key={i} className={styles.userTurn}>
                    <p className={styles.bubble}>{turn.text}</p>
                  </li>
                ) : (
                  <li key={i} className={styles.mentorTurn}>
                    {turn.steps
                      .filter((step) => step.name !== 'offer_replies')
                      .map((step) => (
                        <div key={step.id} className={styles.stepBlock}>
                          {/* A component shows its shape while it is made (ADR 0077). */}
                          {step.name === 'show' ? (
                            step.status !== 'done' && <CardSkeleton />
                          ) : (
                            <ToolStep name={step.name} done={step.status === 'done'} />
                          )}
                          {step.card && (
                            <ToolCard
                              card={step.card}
                              onStart={onStart}
                              plan={plan}
                              onSend={i === turns.length - 1 ? (text) => void send(text) : undefined}
                            />
                          )}
                        </div>
                      ))}
                    {turn.text ? (
                      <div className={styles.answer}>
                        <MentorMarkdown text={turn.text} />
                      </div>
                    ) : (
                      sending &&
                      i === turns.length - 1 &&
                      turn.steps.length === 0 && (
                        <p className={styles.typing} role="status" aria-label={t.mentorThinking}>
                          <span />
                          <span />
                          <span />
                        </p>
                      )
                    )}
                    {turn.text && !(sending && i === turns.length - 1) && (
                      <div className={styles.answerActions}>
                        <time dateTime={turn.sentAt.toISOString()}>{messageTime(turn.sentAt, now, uiLanguage)}</time>
                        <button
                          type="button"
                          className={styles.smallIcon}
                          aria-label={copied === i ? t.mentorChatCopied : t.mentorChatCopy}
                          onClick={() =>
                            void navigator.clipboard.writeText(turn.text).then(() => {
                              setCopied(i);
                              setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500);
                            })
                          }
                        >
                          <CopyIcon aria-hidden="true" />
                        </button>
                        {i === turns.length - 1 && (
                          <button
                            type="button"
                            className={styles.smallIcon}
                            aria-label={t.tryAgain}
                            onClick={() => retry(i)}
                          >
                            <RepeatIcon aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    )}
                    {/* Quick replies (ADR 0074): tap instead of typing, on the latest answer only. */}
                    {i === turns.length - 1 && !sending && (
                      <Replies steps={turn.steps} onPick={(reply) => void send(reply)} />
                    )}
                  </li>
                ),
              )}
            </ol>
          )}
        </div>

        <form
          className={styles.composer}
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
        >
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.box}>
            <textarea
              ref={input}
              className={styles.input}
              value={draft}
              rows={1}
              maxLength={MAX_LENGTH + 50}
              placeholder={t.mentorChatPlaceholder}
              aria-label={t.mentorChatPlaceholder}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKey}
            />
            <div className={styles.boxActions}>
              {canDictate() && (
                <button
                  type="button"
                  className={styles.smallIcon}
                  aria-pressed={listening}
                  aria-label={listening ? t.mentorChatVoiceStop : t.mentorChatVoiceStart}
                  onClick={toggleVoice}
                >
                  <MicIcon aria-hidden="true" />
                </button>
              )}
              <button
                type="submit"
                className={styles.send}
                disabled={!draft.trim() || sending || draft.length > MAX_LENGTH}
                aria-label={t.mentorChatSend}
              >
                <SendIcon aria-hidden="true" />
              </button>
            </div>
          </div>
        </form>
      </section>

      <PlanPanel plan={plan} onStart={(activity) => onStart(activity, 'panel')} />

      <Dialog open={menuFor !== null} onClose={() => setMenuFor(null)} title={menuFor?.title ?? ''}>
        <form
          className={styles.dialogForm}
          onSubmit={(event) => {
            event.preventDefault();
            void rename();
          }}
        >
          <label className={styles.dialogLabel}>
            {t.mentorChatTitleLabel}
            <input value={renaming} maxLength={80} onChange={(event) => setRenaming(event.target.value)} />
          </label>
          <button type="submit" className={styles.confirmButton} disabled={!renaming.trim()}>
            {t.mentorRename}
          </button>
          <button
            type="button"
            className={styles.dangerLink}
            onClick={() => {
              setDeleting(menuFor);
              setMenuFor(null);
            }}
          >
            <TrashIcon aria-hidden="true" /> {t.mentorDeleteChat}
          </button>
        </form>
      </Dialog>
      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} title={t.mentorDeleteChatQuestion}>
        <div className={styles.dialogForm}>
          <p>{t.mentorDeleteChatText}</p>
          <button type="button" className={styles.confirmButton} data-danger onClick={() => void remove()}>
            {t.mentorDeleteChat}
          </button>
          <button type="button" className={styles.dangerLink} data-autofocus onClick={() => setDeleting(null)}>
            {t.cancel}
          </button>
        </div>
      </Dialog>
    </div>
  );
}

function Replies({ steps, onPick }: { steps: MentorToolEvent[]; onPick: (reply: string) => void }) {
  const card = steps.map((s) => s.card).find((c) => c?.type === 'replies');
  if (!card || card.type !== 'replies') return null;
  return (
    <div className={styles.replies} role="group" aria-label={t.mentorQuickReplies}>
      {card.replies.map((reply) => (
        <button key={reply} type="button" className={styles.reply} onClick={() => onPick(reply)}>
          {reply}
        </button>
      ))}
    </div>
  );
}

const lastChatKey = (account: string) => `mentor-last-chat:${account}`;

/** The chat last open on this device; nothing when storage is unavailable. */
function readLastChat(account: string): string | null {
  try {
    return localStorage.getItem(lastChatKey(account));
  } catch {
    return null;
  }
}

function writeLastChat(account: string, id: string): void {
  try {
    localStorage.setItem(lastChatKey(account), id);
  } catch {
    // private mode: the chat opens fresh next time
  }
}
