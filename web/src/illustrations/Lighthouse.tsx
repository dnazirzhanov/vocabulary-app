import { useSvgId } from './useSvgId.ts';

const tower = 'M100 196 L140 196 L133 92 L107 92 Z';

export function Lighthouse() {
  const clip = useSvgId();
  const beamLeft = useSvgId();
  const beamRight = useSvgId();
  return (
    <>
      <defs>
        <clipPath id={clip}>
          <path d={tower} />
        </clipPath>
        <linearGradient id={beamLeft} x1="1" x2="0">
          <stop offset="0" stopColor="var(--illo-light)" stopOpacity="0.9" />
          <stop offset="1" stopColor="var(--illo-light)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={beamRight} x1="0" x2="1">
          <stop offset="0" stopColor="var(--illo-light)" stopOpacity="0.9" />
          <stop offset="1" stopColor="var(--illo-light)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M108 68 L22 48 L22 96 L108 80 Z" fill={`url(#${beamLeft})`} stroke="none" />
      <path d="M132 68 L218 48 L218 96 L132 80 Z" fill={`url(#${beamRight})`} stroke="none" />
      <path d="M58 206 Q120 172 182 206 Z" fill="var(--illo-sand)" />
      <path d="M20 212 q10 -8 20 0 t20 0" fill="none" stroke="var(--illo-sky)" />
      <path d="M180 212 q10 -8 20 0 t20 0" fill="none" stroke="var(--illo-sky)" />
      <path d={tower} fill="var(--illo-white)" stroke="none" />
      <g clipPath={`url(#${clip})`} fill="var(--illo-accent)" strokeWidth={4}>
        <rect x="90" y="92" width="60" height="22" />
        <rect x="90" y="134" width="60" height="22" />
        <rect x="90" y="176" width="60" height="30" />
      </g>
      <path d={tower} fill="none" />
      <path d="M114 196 V184 a6 6 0 0 1 12 0 V196 Z" fill="var(--illo-line)" />
      <rect x="108" y="62" width="24" height="22" fill="var(--illo-light)" />
      <path d="M120 62 V84" strokeWidth={3.5} />
      <rect x="98" y="84" width="44" height="9" rx="2" fill="var(--illo-line)" />
      <path d="M104 62 L136 62 L120 42 Z" fill="var(--illo-accent)" />
      <path d="M120 42 V34" />
    </>
  );
}
