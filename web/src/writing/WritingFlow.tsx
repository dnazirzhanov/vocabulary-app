import { useState } from 'react';
import { QuestionList } from './QuestionList.tsx';
import { ResultScreen } from './ResultScreen.tsx';
import { WritingArchive } from './WritingArchive.tsx';
import { WriteScreen } from './WriteScreen.tsx';
import { WritingHome } from './WritingHome.tsx';
import type { Submission, WritingQuestion } from './api.ts';

type View =
  | { name: 'home' }
  | { name: 'archive' }
  | { name: 'topic'; topic: string }
  | { name: 'write'; question: WritingQuestion; text?: string; back: View }
  | { name: 'result'; submission: Submission; back: View };

/**
 * The whole Writing section: topics → questions → write → feedback. It keeps its own place, so the
 * app's navigation only has to know that «Письмо» is open.
 */
export default function WritingFlow() {
  const [view, setView] = useState<View>({ name: 'home' });
  const home: View = { name: 'home' };

  if (view.name === 'archive') {
    const archive: View = { name: 'archive' };
    return (
      <WritingArchive
        onBack={() => setView(home)}
        onOpen={(submission) => setView({ name: 'result', submission, back: archive })}
        onRetry={(question, text) => setView({ name: 'write', question, text, back: archive })}
      />
    );
  }
  if (view.name === 'topic') {
    return (
      <QuestionList
        topic={view.topic}
        onBack={() => setView(home)}
        onPick={(question) => setView({ name: 'write', question, back: view })}
      />
    );
  }
  if (view.name === 'write') {
    return (
      <WriteScreen
        question={view.question}
        initialText={view.text}
        onBack={() => setView(view.back)}
        onDone={(submission) => setView({ name: 'result', submission, back: view.back })}
      />
    );
  }
  if (view.name === 'result') {
    const { submission, back } = view;
    const question = submission.question;
    const leave = () => setView(back.name === 'write' ? home : back);
    return (
      <ResultScreen
        submission={submission}
        onBack={leave}
        onWriteAgain={question ? () => setView({ name: 'write', question, text: submission.answer, back }) : undefined}
        onAnother={leave}
      />
    );
  }
  return (
    <WritingHome
      onPickTopic={(topic) => setView({ name: 'topic', topic })}
      onOpen={(submission) => setView({ name: 'result', submission, back: home })}
      onRetry={(question, text) => setView({ name: 'write', question, text, back: home })}
      onOpenArchive={() => setView({ name: 'archive' })}
    />
  );
}
