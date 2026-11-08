import type { AuthChangeEvent, Session as AuthSession } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import { bindAccount, closeLocal, deleteLocal, openLocal, withSnapshot } from './local/session.ts';
import { saveSnapshot } from './local/db.ts';
import { syncNow } from './local/sync.ts';
import { setOffline } from './local/online.ts';
import { AuthScreen, NewPasswordScreen } from './auth/AuthScreen.tsx';
import { DeckEditor } from './decks/DeckEditor.tsx';
import { DeckScreen } from './decks/DeckScreen.tsx';
import { WordsScreen } from './words/WordsScreen.tsx';
import { GoalScreen } from './goal/GoalScreen.tsx';
import { GroupScreen } from './groups/GroupScreen.tsx';
import { GroupsScreen } from './groups/GroupsScreen.tsx';
import { JoinScreen } from './groups/JoinScreen.tsx';
import { DeckTestScreen } from './tests/DeckTestScreen.tsx';
import { TestRun } from './tests/TestRun.tsx';
import { TestsScreen } from './tests/TestsScreen.tsx';
import { CourseScreen } from './home/CourseScreen.tsx';
import { HomeScreen } from './home/HomeScreen.tsx';
import { LessonScreen } from './lesson/LessonScreen.tsx';
import { NavShell, type NavTab } from './nav/NavShell.tsx';
import { api, ApiError, describeError } from './lib/api.ts';
import { authMode, supabase } from './lib/auth.ts';
import { forgetRunningTest, runningTest } from './lib/groupTests.ts';
import { forgetDevice } from './lib/push.ts';
import type { Deck, Me, Session, Summary, TestAttempt } from './lib/types.ts';
import { ProgressScreen } from './progress/ProgressScreen.tsx';
import { SessionSummary } from './summary/SessionSummary.tsx';
import { PrimaryButton } from './ui/PrimaryButton.tsx';
import { switchLanguage, t, uiLanguage } from './i18n/index.ts';

type Screen =
  | { name: 'home' }
  | { name: 'session'; session: Session }
  | { name: 'summary'; summary: Summary }
  | { name: 'progress' }
  | { name: 'groups' }
  | { name: 'board'; groupId: string; invite?: boolean }
  // A group's tests (ADR 0046); `initial`: the attempt just started, absent after a reload.
  | { name: 'tests'; groupId: string }
  | { name: 'deck-test'; groupId: string; deckId: string }
  | { name: 'test-run'; groupId: string; deckId: string; attemptId: string; initial?: TestAttempt }
  | { name: 'course' }
  // A deck's page (ADR 0020); `from`: where «Назад» leads.
  | { name: 'deck-page'; deckId: string; from: 'home' | 'course' | 'progress' }
  | { name: 'words'; deckId: string; title: string; mine: boolean; from: 'home' | 'course' | 'progress' }
  // A deck's editor (ADR 0019); `groupId`: opened from that group's board, so «Назад» returns there;
  // `from`: opened from the deck's words (ADR 0051), which «Назад» returns to.
  | { name: 'deck'; deckId: string; groupId: string | null; from?: 'home' | 'course' | 'progress' }
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
  if (code) return { name: 'join', code };
  // A reload in the middle of a test goes straight back to it: its clock keeps running.
  const running = runningTest();
  return running ? { name: 'test-run', ...running } : { name: 'home' };
};

type Account =
  | { status: 'loading' }
  | { status: 'signedOut' }
  // A recovery code was accepted: signed in, but a new password comes before anything else.
  | { status: 'newPassword'; email: string | null; subject: string }
  // `subject` is the sign-in's own id (Supabase's user id, `dev` without sign-in): it finds this
  // device's kept data before the server answers.
  | { status: 'signedIn'; email: string | null; subject: string };

/** Development builds have no sign-in; production builds wait for a Supabase session. */
function useAccount() {
  const [account, setAccount] = useState<Account>(
    authMode === 'dev' ? { status: 'signedIn', email: null, subject: 'dev' } : { status: 'loading' },
  );
  useEffect(() => {
    if (!supabase) return;
    const apply = (event: AuthChangeEvent | null, session: AuthSession | null) =>
      setAccount((current) => {
        if (!session) return { status: 'signedOut' };
        const email = session.user.email ?? null;
        if (event === 'PASSWORD_RECOVERY') return { status: 'newPassword', email, subject: session.user.id };
        // Token refreshes and returning to the tab must not skip the new password.
        return current.status === 'newPassword' ? current : { status: 'signedIn', email, subject: session.user.id };
      });
    void supabase.auth.getSession().then(({ data }) => apply(null, data.session));
    const { data } = supabase.auth.onAuthStateChange(apply);
    return () => data.subscription.unsubscribe();
  }, []);
  const passwordSaved = useCallback(
    () =>
      setAccount((current) =>
        current.status === 'newPassword'
          ? { status: 'signedIn', email: current.email, subject: current.subject }
          : current,
      ),
    [],
  );
  return { account, passwordSaved };
}

/** This device only: a phone stays signed in when the laptop signs out, its reminders stop here. */
async function signOutHere() {
  forgetRunningTest();
  await forgetDevice().catch(() => undefined);
  // What this device kept for the account stays, closed, for its next sign-in; no one else opens it.
  closeLocal();
  await supabase?.auth.signOut({ scope: 'local' });
}

export function App() {
  const { account, passwordSaved } = useAccount();
  if (account.status === 'loading') return null;
  if (account.status === 'signedOut') return <AuthScreen invited={pendingInvite() !== null} />;
  if (account.status === 'newPassword') return <NewPasswordScreen onDone={passwordSaved} />;
  // Keyed by account, so signing in as someone else starts from a fresh home screen.
  return <Learning key={account.subject} email={account.email} subject={account.subject} />;
}

type Profile = { me: Me; decks: Deck[] };

/**
 * The learner's settings and the course levels; without a connection, the last ones this device
 * kept, so the app still opens. Null when the page reloads into another device's chosen language.
 */
async function loadProfile(subject: string): Promise<Profile | null> {
  await openLocal(subject);
  const [me, decks] = await Promise.all([
    withSnapshot('me', () => api.me()),
    withSnapshot('courseDecks', () => api.listDecks()),
  ]);
  const offline = me.offline || decks.offline;
  setOffline(offline);
  if (!offline) {
    // The server named the account: this device's store is its own (another account's never
    // opens), and keeps this answer for the next time there is no connection.
    const db = await bindAccount(subject, me.value.id);
    if (db) await Promise.all([saveSnapshot(db, 'me', me.value), saveSnapshot(db, 'courseDecks', decks.value)]);
    // Changes made here while offline go now; my decks come up to date (ADR 0061).
    void syncNow();
    // Another device chose: follow it. A new account takes what this device shows, saved before
    // anything is shown: sent in the background, it could land after the learner's own first
    // choice of language and undo it.
    if (me.value.ui_language === null) {
      const saved = await api.updateMe({ ui_language: uiLanguage }).catch(() => null);
      return { me: saved ?? me.value, decks: decks.value };
    }
    if (me.value.ui_language !== uiLanguage && switchLanguage(me.value.ui_language)) return null;
  }
  return { me: me.value, decks: decks.value };
}

/** The learner's settings and the decks, which decide whether the first-run screens come first. */
function useProfile(subject: string) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    () =>
      loadProfile(subject).then(
        (loaded) => loaded && setProfile(loaded),
        (caught: unknown) => setError(describeError(caught)),
      ),
    [subject],
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
function Learning({ email, subject }: { email: string | null; subject: string }) {
  const { profile, setProfile, error, retry } = useProfile(subject);
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
          {t.tryAgain}
        </PrimaryButton>
      </main>
    );
  }
  if (!profile) return null;
  const { me, decks } = profile;
  // A name is asked of everyone once, those who started before it was too (ADR 0057).
  if (!me.onboarded || me.name === null) {
    return (
      <GoalScreen
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
        onSpelling={async () => showSession(await api.startSpellingSession(summary.deck_id))}
        onHome={leave}
      />
    );
  }
  if (screen.name === 'test-run') {
    const { groupId, deckId } = screen;
    return (
      <TestRun
        key={screen.attemptId}
        groupId={groupId}
        deckId={deckId}
        attemptId={screen.attemptId}
        initial={screen.initial}
        onDone={() => {
          forgetRunningTest();
          setScreen({ name: 'deck-test', groupId, deckId });
        }}
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
    <NavShell
      tab={tabOf(screen)}
      onNavigate={navigate}
      account={{
        email,
        onSignOut: supabase ? signOutHere : undefined,
        onAccountDeleted: () => {
          // The account is gone, and with it everything this device kept of it.
          void deleteLocal().then(() => (supabase ? signOutHere() : goHome()));
        },
      }}
      onSignOut={supabase && screen.name === 'home' ? signOutHere : undefined}
    >
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
          onStudy={goHome}
          onTests={() => setScreen({ name: 'tests', groupId: screen.groupId })}
          onBack={() => setScreen({ name: 'groups' })}
          onLeft={() => {
            setScreen({ name: 'groups' });
          }}
        />
      );
    }
    if (screen.name === 'tests') {
      const { groupId } = screen;
      return (
        <TestsScreen
          key={groupId}
          groupId={groupId}
          onOpen={(deckId) => setScreen({ name: 'deck-test', groupId, deckId })}
          onBack={() => setScreen({ name: 'board', groupId })}
        />
      );
    }
    if (screen.name === 'deck-test') {
      const { groupId, deckId } = screen;
      return (
        <DeckTestScreen
          key={deckId}
          groupId={groupId}
          deckId={deckId}
          onRun={(attempt) => setScreen({ name: 'test-run', groupId, deckId, attemptId: attempt.id, initial: attempt })}
          onBack={() => setScreen({ name: 'tests', groupId })}
        />
      );
    }
    if (screen.name === 'deck') {
      const { deckId, groupId, from } = screen;
      const leaveEditor = (): Screen => (groupId ? { name: 'board', groupId } : { name: 'home' });
      return (
        <DeckEditor
          key={deckId}
          deckId={deckId}
          backLabel={from ? t.deckWords : groupId ? t.toTheGroup : t.myDecks}
          onDone={(title) => setScreen(from ? { name: 'words', deckId, title, mine: true, from } : leaveEditor())}
          onDeleted={() => setScreen(leaveEditor())}
          onStudy={(session) => startSession(session, deckId)}
          onOpenDeck={(id) => setScreen({ name: 'deck', deckId: id, groupId: null })}
        />
      );
    }
    if (screen.name === 'progress') {
      return <ProgressScreen onOpenDeck={(deckId) => openPage(deckId, 'progress')} />;
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
          backLabel={from === 'course' ? t.course : from === 'progress' ? t.progress : t.myDecks}
          onBack={() => setScreen(backTo(from))}
          onSession={startSession}
          onWords={(id, title, mine) => setScreen({ name: 'words', deckId: id, title, mine, from })}
        />
      );
    }
    if (screen.name === 'words') {
      const { deckId, from } = screen;
      return (
        <WordsScreen
          deckId={deckId}
          deckTitle={screen.title}
          onBack={() => openPage(deckId, from)}
          onEdit={screen.mine ? () => setScreen({ name: 'deck', deckId, groupId: null, from }) : undefined}
        />
      );
    }
    return (
      <HomeScreen
        onOpenPage={(deckId) => openPage(deckId, 'home')}
        onOpenDeck={(deckId) => setScreen({ name: 'deck', deckId, groupId: null })}
        onOpenCourse={decks.length > 0 ? () => setScreen({ name: 'course' }) : undefined}
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
  if (['groups', 'board', 'tests', 'deck-test'].includes(screen.name)) return 'friends';
  if (screen.name === 'deck') return screen.groupId ? 'friends' : 'today';
  return 'today';
}
