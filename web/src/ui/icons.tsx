import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: '0 0 24 24',
  width: 24,
  height: 24,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

export const CloseIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const SpeakerIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </svg>
);

export const CheckIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

export const CrossIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M7 7l10 10M17 7L7 17" />
  </svg>
);

export const RepeatIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M19 12a7 7 0 1 1-2.05-4.95" />
    <path d="M17.5 3.5v4h-4" />
  </svg>
);

export const ChartIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M5 20V12M12 20V5M19 20v-7" />
  </svg>
);

export const BackIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

export const FlameIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path
      d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-2.9 1.9-5 3.6-6.6.4 1.6 1.3 2.6 2.4 3 .1-3.1 1.6-5.6 3.9-7.2-.2 2.6.8 4.4 2.2 6 1.1 1.3 1.9 2.8 1.9 4.8 0 3.6-2.6 6.2-7.5 6.2z"
      fill="currentColor"
      stroke="none"
    />
  </svg>
);

export const AlertIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M12 7v6M12 17h.01" />
  </svg>
);

export const FlagIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M6 21V4" />
    <path d="M6 4h11l-2.5 4L17 12H6" fill="currentColor" />
  </svg>
);

export const CalendarIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <rect x="3.5" y="5" width="17" height="15" rx="3" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);
