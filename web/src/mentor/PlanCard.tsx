import { BookIcon, CardsIcon, ForwardIcon, MarkerIcon } from '../ui/icons.tsx';
import { t } from '../i18n/index.ts';
import type { PlanItem } from './types.ts';
import styles from './PlanCard.module.css';

interface PlanCardProps {
  item: PlanItem;
  onStart: () => void;
  busy: boolean;
}

/** One card on «Today's plan»: title + short reason + duration + a button that starts the activity. */
export function PlanCard({ item, onStart, busy }: PlanCardProps) {
  const title = titleOf(item);
  const reason = reasonOf(item);
  const cta = ctaOf(item);
  return (
    <li className={styles.card}>
      <div className={styles.icon} aria-hidden="true">
        {renderIcon(item)}
      </div>
      <div className={styles.body}>
        <p className={styles.title}>{title}</p>
        <p className={styles.reason}>{reason}</p>
      </div>
      <button type="button" className={styles.action} onClick={onStart} disabled={busy}>
        <span>{cta}</span>
        <ForwardIcon aria-hidden="true" />
      </button>
    </li>
  );
}

function titleOf(item: PlanItem): string {
  if (item.kind === 'vocab') return t.mentorPlanVocabTitle(item.title);
  if (item.kind === 'spelling') return t.mentorPlanSpellingTitle(item.title);
  return t.mentorPlanReadingTitle(item.title);
}

function reasonOf(item: PlanItem): string {
  if (item.kind === 'vocab') return t.mentorPlanVocabReason(item.count, item.minutes);
  if (item.kind === 'spelling') return t.mentorPlanSpellingReason(item.count, item.minutes);
  return t.mentorPlanReadingReason(item.minutes, item.level);
}

function ctaOf(item: PlanItem): string {
  if (item.kind === 'vocab') return t.mentorPlanVocabCta;
  if (item.kind === 'spelling') return t.mentorPlanSpellingCta;
  return t.mentorPlanReadingCta;
}

function renderIcon(item: PlanItem) {
  if (item.kind === 'vocab') return <CardsIcon />;
  if (item.kind === 'spelling') return <MarkerIcon />;
  return <BookIcon />;
}
