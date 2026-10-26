import { useCallback, useState } from 'react';
import { HomeScreen } from './home/HomeScreen.tsx';
import { LessonScreen } from './lesson/LessonScreen.tsx';
import { api } from './lib/api.ts';
import type { Session, Summary } from './lib/types.ts';
import { SessionSummary } from './summary/SessionSummary.tsx';

type Screen = { name: 'home' } | { name: 'session'; session: Session } | { name: 'summary'; summary: Summary };

/** Three screens and no router: all state that matters lives on the server, so home can always reload it. */
export function App() {
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
  return <HomeScreen onSession={showSession} />;
}
