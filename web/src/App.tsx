import { useCallback, useEffect, useState } from 'react';
import { AuthScreen } from './auth/AuthScreen.tsx';
import { GoalScreen } from './goal/GoalScreen.tsx';
import { BoardScreen } from './groups/BoardScreen.tsx';
import { GroupsScreen } from './groups/GroupsScreen.tsx';
import { JoinScreen } from './groups/JoinScreen.tsx';
import { HomeScreen } from './home/HomeScreen.tsx';
import { LessonScreen } from './lesson/LessonScreen.tsx';
import { NavShell, type NavTab } from './nav/NavShell.tsx';
import { ProfileDialog, type ProfileTarget } from './profile/ProfileDialog.tsx';
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
  // The deck a study session was started for (null: the whole course), so «Дальше» keeps to it.
  const [scope, setScope] = useState<string | null>(null);
  const goHome = useCallback(() => setScreen({ name: 'home' }), []);
  const showSession = useCallback((session: Session) => setScreen({ name: 'session', session }), []);
  const startSession = useCallback((session: Session, from: string | null) => {
    setScope(from);
    setScreen({ name: 'session', session });
  }, []);
  const showSummary = useCallback((summary: Summary) => setScreen({ name: 'summary', summary }), []);
  // Bumped when the groups change, so the navigation's line about them refreshes.
  const [navVersion, setNavVersion] = useState(0);
  // The profile window, over whichever screen is showing (ADR 0015).
  const [profileTarget, setProfileTarget] = useState<ProfileTarget | null>(null);

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
    return <LessonScreen key={screen.session.id} session={screen.session} onComplete={showSummary} onExit={goHome} />;
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

  // Every other screen sits in the navigation, which stays mounted while the screens change.
  const refreshNav = () => setNavVersion((version) => version + 1);
  // Moving between sections also refreshes the line about friends.
  const navigate = (tab: NavTab, groupId: string | null) => {
    refreshNav();
    if (tab === 'today') goHome();
    else if (tab === 'progress') setScreen({ name: 'progress' });
    else setScreen(groupId ? { name: 'board', groupId } : { name: 'groups' });
  };
  return (
    <NavShell
      tab={tabOf(screen)}
      version={navVersion}
      onNavigate={navigate}
      onProfile={() => setProfileTarget({ kind: 'me' })}
    >
      {tabScreen()}
      <ProfileDialog target={profileTarget} onClose={() => setProfileTarget(null)} />
    </NavShell>
  );

  function tabScreen() {
    if (screen.name === 'groups') {
      return (
        <GroupsScreen
          onOpen={(groupId, created) => {
            refreshNav();
            setScreen({ name: 'board', groupId, invite: created });
          }}
          onJoinCode={(code) => setScreen({ name: 'join', code })}
        />
      );
    }
    if (screen.name === 'board') {
      return (
        <BoardScreen
          key={screen.groupId}
          groupId={screen.groupId}
          inviteOnOpen={screen.invite}
          onOpenProfile={(memberId, nickname) =>
            setProfileTarget({ kind: 'member', groupId: screen.groupId, memberId, nickname })
          }
          onBack={() => setScreen({ name: 'groups' })}
          onLeft={() => {
            refreshNav();
            setScreen({ name: 'groups' });
          }}
        />
      );
    }
    if (screen.name === 'progress') {
      const client = supabase;
      return (
        <ProgressScreen
          email={email}
          onSignOut={client ? () => void client.auth.signOut() : undefined}
          onAccountDeleted={() => {
            if (client) void client.auth.signOut();
            else goHome();
          }}
        />
      );
    }
    return <HomeScreen onSession={startSession} />;
  }
}

/** The navigation entry a screen belongs to: decks and their words are part of today. */
function tabOf(screen: Screen): NavTab {
  if (screen.name === 'progress') return 'progress';
  if (screen.name === 'groups' || screen.name === 'board') return 'friends';
  return 'today';
}
