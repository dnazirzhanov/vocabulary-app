import { useCallback, useEffect, useState } from 'react';
import { AuthScreen } from './auth/AuthScreen.tsx';
import { DeckEditor } from './decks/DeckEditor.tsx';
import { DeckScreen } from './decks/DeckScreen.tsx';
import { WordsScreen } from './words/WordsScreen.tsx';
import { GoalScreen } from './goal/GoalScreen.tsx';
import { GroupScreen } from './groups/GroupScreen.tsx';
import { GroupsScreen } from './groups/GroupsScreen.tsx';
import { JoinScreen } from './groups/JoinScreen.tsx';
import { CourseScreen } from './home/CourseScreen.tsx';
import { HomeScreen } from './home/HomeScreen.tsx';
import { LessonScreen } from './lesson/LessonScreen.tsx';
import { NavShell, type NavTab } from './nav/NavShell.tsx';
import { api, ApiError, describeError } from './lib/api.ts';
import { authMode, supabase } from './lib/auth.ts';
import { currentDeck } from './lib/today.ts';
import type { Deck, Me, Session, Summary } from './lib/types.ts';
import { courseOf } from './lib/course.ts';
import { ProgressScreen } from './progress/ProgressScreen.tsx';
import { SessionSummary } from './summary/SessionSummary.tsx';
import { PrimaryButton } from './ui/PrimaryButton.tsx';

type Screen =
  | { name: 'home' }
  | { name: 'session'; session: Session }
  | { name: 'summary'; summary: Summary }
  | { name: 'progress' }
  | { name: 'groups' }
  | { name: 'board'; groupId: string; invite?: boolean }
  | { name: 'course' }
  // A deck's page (ADR 0020); `from`: where «Назад» leads.
  | { name: 'deck-page'; deckId: string; from: 'home' | 'course' | 'progress' }
  | { name: 'words'; deckId: string; title: string; from: 'home' | 'course' | 'progress' }
  // A deck's editor (ADR 0019); `groupId`: opened from that group's board, so «Назад» returns there.
  | { name: 'deck'; deckId: string; groupId: string | null }
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

type Profile = { me: Me; decks: Deck[] };

/** The learner's settings and the decks, which decide whether the first-run screens come first. */
function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      Promise.all([api.me(), api.listDecks()]).then(
        ([me, decks]) => setProfile({ me, decks }),
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
  // The deck a study session was started for, so «Дальше» keeps to it and leaving returns to its
  // page; and where that page was opened from, for its «Назад».
  const [scope, setScope] = useState<string | null>(null);
  const [pageFrom, setPageFrom] = useState<'home' | 'course' | 'progress'>('home');
  const goHome = useCallback(() => setScreen({ name: 'home' }), []);
  const openPage = useCallback((deckId: string, from: 'home' | 'course' | 'progress') => {
    setPageFrom(from);
    setScreen({ name: 'deck-page', deckId, from });
  }, []);
  // After a lesson: back to the deck it was from.
  const leave = useCallback(
    () => (scope ? openPage(scope, pageFrom) : setScreen({ name: 'home' })),
    [scope, pageFrom, openPage],
  );
  const showSession = useCallback((session: Session) => setScreen({ name: 'session', session }), []);
  const startSession = useCallback((session: Session, from: string | null) => {
    setScope(from);
    setScreen({ name: 'session', session });
  }, []);
  const showSummary = useCallback((summary: Summary) => setScreen({ name: 'summary', summary }), []);
  // Bumped when the groups change, so the navigation's line about them refreshes.

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
  const { me, decks } = profile;
  const current = currentDeck(decks);
  if (current && !me.onboarded) {
    return (
      <GoalScreen
        course={courseOf(decks)}
        me={me}
        onDone={(updated) => {
          setProfile({ me: updated, decks });
          setScreen(startScreen());
        }}
      />
    );
  }
  if (screen.name === 'session') {
    return <LessonScreen key={screen.session.id} session={screen.session} onComplete={showSummary} onExit={leave} />;
  }
  if (screen.name === 'summary') {
    const { summary } = screen;
    return (
      <SessionSummary
        summary={summary}
        onPractice={async () => showSession(await api.startHardSession(summary.deck_id))}
        onNext={async () => {
          // Another study session if anything is due or new words remain; otherwise home explains.
          try {
            showSession(await api.startStudySession(scope));
          } catch (error) {
            if (error instanceof ApiError && error.status === 409) goHome();
            else throw error;
          }
        }}
        onSpelling={async () => showSession(await api.startSpellingSession())}
        onHome={leave}
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

  // Every other screen sits in the navigation, which stays mounted while the screens change.
  const navigate = (tab: NavTab) => {
    if (tab === 'today') goHome();
    else if (tab === 'progress') setScreen({ name: 'progress' });
    // «Друзья» always opens the list of groups first (ADR 0023).
    else setScreen({ name: 'groups' });
  };
  return (
    <NavShell tab={tabOf(screen)} onNavigate={navigate}>
      {tabScreen()}
    </NavShell>
  );

  function tabScreen() {
    if (screen.name === 'groups') {
      return (
        <GroupsScreen
          onOpen={(groupId, created) => {
            setScreen({ name: 'board', groupId, invite: created });
          }}
          onJoinCode={(code) => setScreen({ name: 'join', code })}
        />
      );
    }
    if (screen.name === 'board') {
      return (
        <GroupScreen
          key={screen.groupId}
          groupId={screen.groupId}
          inviteOnOpen={screen.invite}
          onOpenDeck={(deckId) => setScreen({ name: 'deck', deckId, groupId: screen.groupId })}
          onBack={() => setScreen({ name: 'groups' })}
          onLeft={() => {
            setScreen({ name: 'groups' });
          }}
        />
      );
    }
    if (screen.name === 'deck') {
      const { groupId } = screen;
      return (
        <DeckEditor
          key={screen.deckId}
          deckId={screen.deckId}
          backLabel={groupId ? 'К группе' : 'Мои колоды'}
          onDone={() => setScreen(groupId ? { name: 'board', groupId } : { name: 'home' })}
          onStudy={(session) => startSession(session, screen.deckId)}
          onOpenDeck={(id) => setScreen({ name: 'deck', deckId: id, groupId: null })}
        />
      );
    }
    if (screen.name === 'progress') {
      return (
        <ProgressScreen
          onOpenDeck={(deckId) => openPage(deckId, 'progress')}
          account={{
            email,
            onSignOut: supabase ? () => void supabase?.auth.signOut() : undefined,
            onAccountDeleted: () => {
              if (supabase) void supabase.auth.signOut();
              else goHome();
            },
          }}
        />
      );
    }
    if (screen.name === 'course') {
      return <CourseScreen onOpenDeck={(deckId) => openPage(deckId, 'course')} onBack={goHome} />;
    }
    if (screen.name === 'deck-page') {
      const { deckId, from } = screen;
      return (
        <DeckScreen
          key={deckId}
          deckId={deckId}
          backLabel={from === 'course' ? 'Курс' : from === 'progress' ? 'Прогресс' : 'Мои колоды'}
          onBack={() => setScreen(backTo(from))}
          onSession={startSession}
          onWords={(id, title) => setScreen({ name: 'words', deckId: id, title, from })}
          onEdit={(id) => setScreen({ name: 'deck', deckId: id, groupId: null })}
        />
      );
    }
    if (screen.name === 'words') {
      const { deckId, from } = screen;
      return <WordsScreen deckId={deckId} deckTitle={screen.title} onBack={() => openPage(deckId, from)} />;
    }
    return (
      <HomeScreen
        onOpenPage={(deckId) => openPage(deckId, 'home')}
        onOpenDeck={(deckId) => setScreen({ name: 'deck', deckId, groupId: null })}
        onOpenCourse={() => setScreen({ name: 'course' })}
      />
    );
  }
}

/** The navigation entry a screen belongs to: decks and their words are part of today. */
/** Where a deck's page goes back to. */
function backTo(from: 'home' | 'course' | 'progress'): Screen {
  if (from === 'course') return { name: 'course' };
  if (from === 'progress') return { name: 'progress' };
  return { name: 'home' };
}

function tabOf(screen: Screen): NavTab {
  if (screen.name === 'progress') return 'progress';
  if (screen.name === 'groups' || screen.name === 'board') return 'friends';
  if (screen.name === 'deck') return screen.groupId ? 'friends' : 'today';
  return 'today';
}
