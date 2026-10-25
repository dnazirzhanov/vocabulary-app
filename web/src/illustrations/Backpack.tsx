export function Backpack() {
  return (
    <>
      <ellipse cx="120" cy="210" rx="58" ry="6" fill="var(--illo-shadow)" stroke="none" />
      <path d="M106 62 C106 36 134 36 134 62" fill="none" strokeWidth={8} />
      <rect x="56" y="122" width="24" height="60" rx="9" fill="var(--illo-peach)" />
      <rect x="160" y="122" width="24" height="60" rx="9" fill="var(--illo-peach)" />
      <rect x="72" y="58" width="96" height="146" rx="34" fill="var(--illo-accent)" />
      <path
        d="M72 104 V92 A34 34 0 0 1 106 58 H134 A34 34 0 0 1 168 92 V104 C140 116 100 116 72 104 Z"
        fill="var(--illo-accent)"
      />
      <rect x="112" y="104" width="16" height="22" rx="4" fill="var(--illo-line)" />
      <rect x="88" y="138" width="64" height="50" rx="16" fill="var(--illo-peach)" />
      <path d="M98 154 H142" strokeWidth={4} />
      <path d="M136 154 V164" strokeWidth={4} />
      <path d="M82 120 V134" fill="none" stroke="var(--illo-white)" />
    </>
  );
}
