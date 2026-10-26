import type { CSSProperties, ReactNode } from 'react';
import styles from './CompletionBadge.module.css';

const cx = 120;
const cy = 104;

function starPath(points: number, outer: number, inner: number) {
  const vertices = Array.from({ length: points * 2 }, (_, i) => {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI * i) / points - Math.PI / 2;
    return `${(cx + radius * Math.cos(angle)).toFixed(1)} ${(cy + radius * Math.sin(angle)).toFixed(1)}`;
  });
  return `M${vertices.join(' L')} Z`;
}

// 18-point rosette; round stroke joins soften the points into a seal edge.
const rosette = starPath(18, 74, 66);
const star = starPath(5, 30, 13);

// Each piece bursts outward from the badge centre to its resting place.
function Confetti({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  const style = { '--dx': `${(cx - x) * 0.6}px`, '--dy': `${(cy - y) * 0.6}px` } as CSSProperties;
  return (
    <g className={styles.confetti} style={style}>
      {children}
    </g>
  );
}

/** Reward badge for a finished session: a check for completion, a star for a session without mistakes. */
export function CompletionBadge({ perfect }: { perfect: boolean }) {
  return (
    <div className={styles.badge} aria-hidden="true">
      <svg viewBox="0 0 240 240" className={styles.art}>
        <g stroke="var(--illo-line)" strokeWidth={5} strokeLinejoin="round" strokeLinecap="round">
          <Confetti x={42} y={58}>
            <circle cx="42" cy="58" r="6" fill="var(--illo-sky)" strokeWidth={3} />
          </Confetti>
          <Confetti x={196} y={50}>
            <rect x="189" y="46" width="14" height="8" rx="2" fill="var(--illo-light)" strokeWidth={3} transform="rotate(30 196 50)" />
          </Confetti>
          <Confetti x={208} y={124}>
            <path d="M200 130 L208 114 L216 130 Z" fill="var(--illo-peach)" strokeWidth={3} />
          </Confetti>
          <Confetti x={28} y={138}>
            <circle cx="28" cy="138" r="5" fill="var(--illo-accent)" strokeWidth={3} />
          </Confetti>
          <Confetti x={46} y={190}>
            <rect x="39" y="186" width="14" height="8" rx="2" fill="var(--illo-light)" strokeWidth={3} transform="rotate(-24 46 190)" />
          </Confetti>
          <Confetti x={198} y={186}>
            <circle cx="198" cy="186" r="6" fill="var(--illo-sky)" strokeWidth={3} />
          </Confetti>
          <Confetti x={72} y={22}>
            <rect x="66" y="18" width="12" height="7" rx="2" fill="var(--illo-accent)" strokeWidth={3} transform="rotate(-32 72 22)" />
          </Confetti>
          <Confetti x={170} y={18}>
            <circle cx="170" cy="18" r="5" fill="var(--illo-peach)" strokeWidth={3} />
          </Confetti>

          <path d="M100 150 L80 212 L95 204 L104 220 L124 158 Z" fill="var(--illo-peach)" />
          <path d="M140 150 L160 212 L145 204 L136 220 L116 158 Z" fill="var(--illo-peach)" />
          <path d={rosette} fill="var(--illo-accent)" />
          <circle cx={cx} cy={cy} r="50" fill="var(--illo-white)" />
          <circle cx={cx} cy={cy} r="42" fill="none" stroke="var(--illo-sand)" strokeWidth={4} />
          <path d="M70 84 A54 54 0 0 1 92 56" fill="none" stroke="var(--illo-white)" />
          {perfect ? (
            <path d={star} fill="var(--illo-light)" className={styles.mark} />
          ) : (
            <path d="M101 105 L114 118 L140 90" fill="none" strokeWidth={10} className={styles.mark} />
          )}
        </g>
      </svg>
    </div>
  );
}
