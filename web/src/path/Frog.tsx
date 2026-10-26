/** The learner's marker on the path: a small original frog (stepping stones are a frog's road). */
export function Frog({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <ellipse cx="32" cy="58" rx="18" ry="3.5" fill="var(--illo-shadow)" />
      <ellipse cx="18" cy="53" rx="7" ry="4" fill="var(--illo-accent)" stroke="var(--illo-line)" strokeWidth="2.5" />
      <ellipse cx="46" cy="53" rx="7" ry="4" fill="var(--illo-accent)" stroke="var(--illo-line)" strokeWidth="2.5" />
      <path
        d="M10 42c0-11 10-19 22-19s22 8 22 19c0 8-9 13-22 13S10 50 10 42z"
        fill="var(--illo-accent)"
        stroke="var(--illo-line)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <ellipse cx="32" cy="45" rx="11" ry="7" fill="var(--illo-peach)" />
      <circle cx="21" cy="22" r="8.5" fill="var(--illo-white)" stroke="var(--illo-line)" strokeWidth="3" />
      <circle cx="43" cy="22" r="8.5" fill="var(--illo-white)" stroke="var(--illo-line)" strokeWidth="3" />
      <circle cx="22.5" cy="23" r="3.6" fill="var(--illo-line)" />
      <circle cx="44.5" cy="23" r="3.6" fill="var(--illo-line)" />
      <circle cx="23.6" cy="21.6" r="1.1" fill="var(--illo-white)" />
      <circle cx="45.6" cy="21.6" r="1.1" fill="var(--illo-white)" />
      <path d="M25 36q7 5 14 0" fill="none" stroke="var(--illo-line)" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="17" cy="36" r="2.5" fill="var(--illo-peach)" />
      <circle cx="47" cy="36" r="2.5" fill="var(--illo-peach)" />
    </svg>
  );
}
