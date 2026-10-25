import { useState } from 'react';
import { demoLesson } from './lesson/demoLesson.ts';
import type { AnswerResult } from './lesson/lessonSession.ts';
import { LessonScreen } from './lesson/LessonScreen.tsx';
import type { ChoiceExercise } from './lesson/types.ts';
import { SessionSummary, type SessionKind } from './summary/SessionSummary.tsx';

interface Session {
  id: number;
  kind: SessionKind;
  exercises: readonly ChoiceExercise[];
}

export function App() {
  const [session, setSession] = useState<Session>({ id: 0, kind: 'lesson', exercises: demoLesson });
  const [results, setResults] = useState<readonly AnswerResult[] | null>(null);

  const start = (kind: SessionKind, exercises: readonly ChoiceExercise[]) => {
    setSession((current) => ({ id: current.id + 1, kind, exercises }));
    setResults(null);
  };

  if (results) {
    return (
      <SessionSummary
        kind={session.kind}
        exercises={session.exercises}
        results={results}
        onPracticeMistakes={(ids) =>
          start(
            'mistakes',
            session.exercises.filter((exercise) => ids.includes(exercise.id)),
          )
        }
        onRestart={() => start('lesson', demoLesson)}
      />
    );
  }

  return <LessonScreen key={session.id} exercises={session.exercises} onComplete={setResults} />;
}
