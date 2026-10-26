import { useCallback, useEffect, useState } from 'react';
import { AuthScreen } from './auth/AuthScreen.tsx';
import { HomeScreen } from './home/HomeScreen.tsx';
import { LessonScreen } from './lesson/LessonScreen.tsx';
import { api } from './lib/api.ts';
import { authMode, supabase } from './lib/auth.ts';
import type { Session, Summary } from './lib/types.ts';
import { ProgressScreen } from './progress/ProgressScreen.tsx';
import { SessionSummary } from './summary/SessionSummary.tsx';

type Screen =
  | { name: 'home' }
  | { name: 'session'; session: Session }
  | { name: 'summary'; summary: Summary }
  | { name: 'progress'; deckId: string };

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
  if (account.status === 'signedOut') return <AuthScreen />;
  // Keyed by account, so signing in as someone else starts from a fresh home screen.
  return <Learning key={account.email ?? 'dev'} email={account.email} />;
}

/** Three screens and no router: all state that matters lives on the server, so home can always reload it. */
function Learning({ email }: { email: string | null }) {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const goHome = useCallback(() => setScreen({ name: 'home' }), []);
  const showSession = useCallback((session: Session) => setScreen({ name: 'session', session }), []);
  const showSummary = useCallback((summary: Summary) => setScreen({ name: 'summary', summary }), []);

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
  return <HomeScreen onSession={showSession} onProgress={(deckId) => setScreen({ name: 'progress', deckId })} />;
}
