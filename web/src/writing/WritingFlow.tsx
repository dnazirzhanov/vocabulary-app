import { useEffect, useState } from 'react';
import { request } from '../lib/api.ts';
import { QuestionList } from './QuestionList.tsx';
import { ResultScreen } from './ResultScreen.tsx';
import { WritingArchive, type ArchivePlace } from './WritingArchive.tsx';
import { WriteScreen } from './WriteScreen.tsx';
import { WritingHome } from './WritingHome.tsx';
import type { Submission, WritingQuestion } from './api.ts';

type View =
  | { name: 'home' }
  | { name: 'archive'; place: ArchivePlace }
  | { name: 'topic'; topic: string }
  | { name: 'write'; question: WritingQuestion; text?: string; back: View }
  | { name: 'result'; submission: Submission; back: View };

/**
 * The whole Writing section: topics → questions → write → feedback. It keeps its own place, so the
 * app's navigation only has to know that «Письмо» is open.
 */
export default function WritingFlow({ questionId }: { questionId?: string } = {}) {
  const [view, setView] = useState<View>({ name: 'home' });
  const home: View = { name: 'home' };
  // Opened from a group task's material (ADR 0096): straight to that question.
  useEffect(() => {
    if (!questionId) return;
    let live = true;
    request<WritingQuestion[]>('GET', '/writing/questions').then(
      (all) => {
        const question = all.find((q) => q.id === questionId);
        if (live && question) setView({ name: 'write', question, back: { name: 'home' } });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [questionId]);

  if (view.name === 'archive') {
    const { place } = view;
    const here: View = view;
    // Back climbs one level: attempts → the topic's questions → all topics → home.
    const up = place.questionId ? { topic: place.topic } : place.topic ? {} : null;
    return (
      <WritingArchive
        key={`${place.topic ?? ''}/${place.questionId ?? ''}`}
        place={place}
        onGo={(next) => setView({ name: 'archive', place: next })}
        onBack={() => setView(up ? { name: 'archive', place: up } : home)}
        onOpen={(submission) => setView({ name: 'result', submission, back: here })}
        onRetry={(question, text) => setView({ name: 'write', question, text, back: here })}
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
      onOpenArchive={() => setView({ name: 'archive', place: {} })}
    />
  );
}
