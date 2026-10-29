import { useCallback, useEffect, useState } from 'react';
import { AuthScreen } from './auth/AuthScreen.tsx';
import { GoalScreen } from './goal/GoalScreen.tsx';
import { BoardScreen } from './groups/BoardScreen.tsx';
import { GroupsScreen } from './groups/GroupsScreen.tsx';
import { JoinScreen } from './groups/JoinScreen.tsx';
import { HomeScreen } from './home/HomeScreen.tsx';
import { LessonScreen } from './lesson/LessonScreen.tsx';
import { api, describeError } from './lib/api.ts';
import { authMode, supabase } from './lib/auth.ts';
import type { Deck, Me, Session, Summary } from './lib/types.ts';
import { ProgressScreen } from './progress/ProgressScreen.tsx';
import { SessionSummary } from './summary/SessionSummary.tsx';
import { WordsScreen } from './words/WordsScreen.tsx';
import { PrimaryButton } from './ui/PrimaryButton.tsx';

type Screen =
  | { name: 'home' }
  | { name: 'session'; session: Session }
  | { name: 'summary'; summary: Summary }
  | { name: 'progress'; deckId: string }
  | { name: 'goal' }
  | { name: 'words' }
  | { name: 'groups' }
  | { name: 'board'; groupId: string }
  | { name: 'join'; code: string };

// An invite link (/join/CODE) is remembered for this tab, so it survives signing in and the
// first-run screens; the address bar goes back to "/" because the app has no router.
const INVITE_KEY = 'pendingInvite';
function rememberInviteFromUrl() {
  const match = /^\/join\/([A-Za-z0-9-]{4,16})\/?$/.exec(location.pathname);
  if (!match) return;
  try {
    sessionStorage.setItem(INVITE_KEY, match[1]);
  } catch {
    // storage unavailable (private mode): the join screen still opens for this page load
    pendingFallback = match[1];
  }
  history.replaceState(null, '', '/');
}
let pendingFallback: string | null = null;
function pendingInvite(): string | null {
  try {
    return sessionStorage.getItem(INVITE_KEY) ?? pendingFallback;
  } catch {
    return pendingFallback;
  }
}
function forgetInvite() {
  pendingFallback = null;
  try {
    sessionStorage.removeItem(INVITE_KEY);
  } catch {
    // nothing stored
  }
}
rememberInviteFromUrl();
const startScreen = (): Screen => {
  const code = pendingInvite();
  return code ? { name: 'join', code } : { name: 'home' };
};

type Account = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; email: string | null };

/** Development builds have no sign-in; production builds wait for a Supabase session. */
function useAccount(): Account {
  const [account, setAccount] = useState<Account>(
    authMode === 'dev' ? { status: 'signedIn', email: null } : { status: 'loading' },
  );
  useEffect(() => {
    if (!supabase) return;
    const apply = (email: string | null | undefined, signedIn: boolean) =>
      setAccount(signedIn ? { status: 'signedIn', email: email ?? null } : { status: 'signedOut' });
    void supabase.auth.getSession().then(({ data }) => apply(data.session?.user.email, Boolean(data.session)));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => apply(session?.user.email, Boolean(session)));
    return () => data.subscription.unsubscribe();
  }, []);
  return account;
}

export function App() {
  const account = useAccount();
  if (account.status === 'loading') return null;
  if (account.status === 'signedOut') return <AuthScreen invited={pendingInvite() !== null} />;
  // Keyed by account, so signing in as someone else starts from a fresh home screen.
  return <Learning key={account.email ?? 'dev'} email={account.email} />;
}

type Profile = { me: Me; deck: Deck | undefined };

/** The learner's settings and the deck, which decide whether the first-run screens come first. */
function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      Promise.all([api.me(), api.listDecks()]).then(
        ([me, decks]) => setProfile({ me, deck: decks[0] }),
        (caught: unknown) => setError(describeError(caught)),
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const retry = () => {
    setError(null);
    void load();
  };
  return { profile, setProfile, error, retry };
}

/** A few screens and no router: all state that matters lives on the server, so home can always reload it. */
function Learning({ email }: { email: string | null }) {
  const { profile, setProfile, error, retry } = useProfile();
  const [screen, setScreen] = useState<Screen>(startScreen);
  const goHome = useCallback(() => setScreen({ name: 'home' }), []);
  const showSession = useCallback((session: Session) => setScreen({ name: 'session', session }), []);
  const showSummary = useCallback((summary: Summary) => setScreen({ name: 'summary', summary }), []);

  if (error) {
    return (
      <main className="message-screen">
        <p role="alert">{error}</p>
        <PrimaryButton type="button" onClick={retry}>
          Повторить
        </PrimaryButton>
      </main>
    );
  }
  if (!profile) return null;
  const { me, deck } = profile;
  if (deck && (!me.onboarded || screen.name === 'goal')) {
    return (
      <GoalScreen
        mode={me.onboarded ? 'edit' : 'onboarding'}
        deck={deck}
        me={me}
        onDone={(updated) => {
          setProfile({ me: updated, deck });
          setScreen(startScreen());
        }}
        onBack={me.onboarded ? goHome : undefined}
      />
    );
  }

  if (screen.name === 'session') {
    return <LessonScreen key={screen.session.id} session={screen.session} onComplete={showSummary} onExit={goHome} />;
  }
  if (screen.name === 'summary') {
    const { summary } = screen;
    return (
      <SessionSummary
        summary={summary}
        onPractice={async () => showSession(await api.startPracticeSession(summary.session_id))}
        onNext={async () => {
          // Same priority as home: due reviews first, then new words, otherwise home explains.
          const deck = (await api.listDecks()).find((candidate) => candidate.id === summary.deck_id);
          if (deck && deck.due_count > 0) showSession(await api.startReviewSession(deck.id));
          else if (deck && deck.introduced_count < deck.word_count) showSession(await api.startNewSession(deck.id));
          else goHome();
        }}
        onHome={goHome}
      />
    );
  }
  if (screen.name === 'join') {
    return (
      <JoinScreen
        code={screen.code}
        onJoined={(groupId) => {
          forgetInvite();
          setScreen({ name: 'board', groupId });
        }}
        onCancel={() => {
          forgetInvite();
          goHome();
        }}
      />
    );
  }
  if (screen.name === 'groups') {
    return (
      <GroupsScreen
        onBack={goHome}
        onOpen={(groupId) => setScreen({ name: 'board', groupId })}
        onJoinCode={(code) => setScreen({ name: 'join', code })}
      />
    );
  }
  if (screen.name === 'board') {
    return (
      <BoardScreen
        key={screen.groupId}
        groupId={screen.groupId}
        onBack={goHome}
        onLeft={() => setScreen({ name: 'groups' })}
      />
    );
  }
  if (screen.name === 'words' && deck) {
    return <WordsScreen deckId={deck.id} deckTitle={deck.title} onBack={goHome} />;
  }
  if (screen.name === 'progress') {
    const client = supabase;
    return (
      <ProgressScreen
        deckId={screen.deckId}
        email={email}
        onBack={goHome}
        onSignOut={client ? () => void client.auth.signOut() : undefined}
        onAccountDeleted={() => {
          if (client) void client.auth.signOut();
          else goHome();
        }}
      />
    );
  }
  return (
    <HomeScreen
      onSession={showSession}
      onProgress={(deckId) => setScreen({ name: 'progress', deckId })}
      onGoal={() => setScreen({ name: 'goal' })}
      onWords={() => setScreen({ name: 'words' })}
      onFriends={(groupId) => setScreen(groupId ? { name: 'board', groupId } : { name: 'groups' })}
    />
  );
}
