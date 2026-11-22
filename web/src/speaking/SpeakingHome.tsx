import { useEffect, useState } from 'react';
import { t } from '../i18n/index.ts';
import { listQuestions, type SpeakingQuestion } from './api.ts';
import { ChartIcon, MicIcon, RepeatIcon } from '../ui/icons.tsx';
import styles from './SpeakingHome.module.css';

interface SpeakingHomeProps {
  /** The three cards, or the topics inside «Говорение». */
  view?: 'home' | 'topics';
  onOpenTopics: () => void;
  onSelectTopic: (topic: string, questions: SpeakingQuestion[]) => void;
  onSelectShadowing: () => void;
  onOpenArchive: () => void;
  onBack: () => void;
}

interface TopicEntry {
  topic: string;
  questions: SpeakingQuestion[];
}

/**
 * Speaking's home: three cards, «Шэдоуинг», «Говорение» and «Мои ответы» (the owner, 22 November 2026).
 * «Говорение» opens its topics here, as a second view.
 */
export function SpeakingHome({
  view = 'home',
  onOpenTopics,
  onSelectTopic,
  onSelectShadowing,
  onOpenArchive,
  onBack,
}: SpeakingHomeProps) {
  const [topics, setTopics] = useState<TopicEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listQuestions()
      .then((qs) => {
        if (cancelled) return;
        const map = new Map<string, SpeakingQuestion[]>();
        for (const q of qs) {
          const bucket = map.get(q.topic) ?? [];
          bucket.push(q);
          map.set(q.topic, bucket);
        }
        setTopics(Array.from(map.entries()).map(([topic, questions]) => ({ topic, questions })));
      })
      .catch(() => {
        if (!cancelled) setError(t.speakingLoadError);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (view === 'home') {
    const cards = [
      {
        key: 'shadowing',
        icon: <RepeatIcon />,
        title: t.speakingModeShadowing,
        text: t.speakingCardShadowingText,
        open: onSelectShadowing,
      },
      {
        key: 'speaking',
        icon: <MicIcon />,
        title: t.speakingExerciseHeading,
        text: t.speakingCardSpeakingText(topics.length),
        open: onOpenTopics,
      },
      {
        key: 'archive',
        icon: <ChartIcon />,
        title: t.speakingArchive,
        text: t.speakingCardArchiveText,
        open: onOpenArchive,
      },
    ];
    return (
      <main className={styles.screen}>
        <header className={styles.header}>
          <button type="button" className={styles.back} onClick={onBack}>
            {t.speakingBack}
          </button>
          <h1 className={styles.title}>{t.speaking}</h1>
        </header>
        <ul className={styles.cards}>
          {cards.map((card) => (
            <li key={card.key}>
              <button type="button" className={styles.card} data-card={card.key} onClick={card.open}>
                <span className={styles.cardIcon} aria-hidden="true">
                  {card.icon}
                </span>
                <span className={styles.cardBody}>
                  <span className={styles.cardTitle}>{card.title}</span>
                  <span className={styles.cardText}>{card.text}</span>
                </span>
                <span className={styles.arrow} aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      </main>
    );
  }

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <button type="button" className={styles.back} onClick={onBack}>
          {t.speakingBack}
        </button>
        <h1 className={styles.title}>{t.speakingTopicsHeading}</h1>
      </header>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      <ul className={styles.list}>
        {topics.map(({ topic, questions }) => (
          <li key={topic}>
            <button type="button" className={styles.topicCard} onClick={() => onSelectTopic(topic, questions)}>
              <span className={styles.topicName}>{topic}</span>
              <span className={styles.topicMeta}>
                {questions.length} {questions.length === 1 ? t.speakingQuestionSingular : t.speakingQuestionPlural}
              </span>
              <span className={styles.arrow}>›</span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
