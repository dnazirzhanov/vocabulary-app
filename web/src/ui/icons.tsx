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

/** Speaking an answer instead of typing it (Reading Mode). */
export const MicIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <rect x="9" y="3.5" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
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

export const HomeIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M4 10.5L12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />
  </svg>
);

export const BulbIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M9 18h6M10 21h4" />
    <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" />
  </svg>
);

export const PencilIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z" />
    <path d="M13.5 7l3 3" />
  </svg>
);

export const PersonIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
  </svg>
);

/** An arrow out of a tray: handing something on — «Дать группе» (the invite keeps PersonPlusIcon). */
export const ShareIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M12 15V4M8 8l4-4 4 4" />
    <path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
  </svg>
);

export const PersonPlusIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <circle cx="9" cy="8.5" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M19 8v6M16 11h6" />
  </svg>
);

export const PeopleIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <circle cx="9" cy="8.5" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18.5 14.2A6.5 6.5 0 0 1 21.5 20" />
  </svg>
);

export const TrashIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </svg>
);

export const CameraIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);

export const GearIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

export const PlusIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const ForwardIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M9 18l6-6-6-6" />
  </svg>
);

export const LockIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
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

export const MuteIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
    <path d="M16 9.5l5 5M21 9.5l-5 5" />
  </svg>
);

export const MoreIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <circle cx="5" cy="12" r="1.25" fill="currentColor" />
    <circle cx="12" cy="12" r="1.25" fill="currentColor" />
    <circle cx="19" cy="12" r="1.25" fill="currentColor" />
  </svg>
);

export const BackspaceIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z" />
    <path d="m12 9 6 6M18 9l-6 6" />
  </svg>
);

export const HelpIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.3a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2.2-2.4 3.7" />
    <path d="M12 17.2h.01" />
  </svg>
);

export const BookIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5Z" />
    <path d="M12 6.5v13" />
  </svg>
);

export const CardsIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <rect x="3.5" y="7" width="13" height="13" rx="2.5" />
    <path d="M7.5 3.5h10a3 3 0 0 1 3 3v10" />
  </svg>
);

export const MarkerIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="m14.5 4.5 5 5L10 19H5v-5l9.5-9.5Z" />
    <path d="M4 22h16" />
  </svg>
);
