import { useSvgId } from './useSvgId.ts';

const body =
  'M64 196 L176 196 C184 196 186 190 184 182 L168 112 C164 98 152 90 138 90 L102 90 C88 90 76 98 72 112 L56 182 C54 190 56 196 64 196 Z';

export function Kettle() {
  const clip = useSvgId();
  return (
    <>
      <clipPath id={clip}>
        <path d={body} />
      </clipPath>
      <ellipse cx="120" cy="206" rx="66" ry="6" fill="var(--illo-shadow)" stroke="none" />
      <path d="M44 94 q-8 -8 0 -16 q8 -8 0 -16" fill="none" stroke="var(--illo-mist)" />
      <path d="M26 106 q-8 -8 0 -16 q8 -8 0 -16" fill="none" stroke="var(--illo-mist)" />
      <path d="M82 150 L52 116" strokeWidth={24} />
      <path d="M82 150 L52 116" stroke="var(--illo-accent)" strokeWidth={13} />
      <path d="M88 96 C86 38 154 38 152 96" fill="none" strokeWidth={10} />
      <path d={body} fill="var(--illo-accent)" />
      <rect x="40" y="164" width="160" height="14" fill="var(--illo-peach)" strokeWidth={4} clipPath={`url(#${clip})`} />
      <path d={body} fill="none" />
      <path d="M94 90 C100 72 140 72 146 90 Z" fill="var(--illo-peach)" />
      <circle cx="120" cy="70" r="7" fill="var(--illo-line)" />
      <path d="M156 118 Q162 134 165 150" fill="none" stroke="var(--illo-white)" />
    </>
  );
}
