import { Backpack } from './Backpack.tsx';
import { Kettle } from './Kettle.tsx';
import { Key } from './Key.tsx';
import { Lighthouse } from './Lighthouse.tsx';
import { Umbrella } from './Umbrella.tsx';

/*
 * House style: 240×240 artboard, one subject, 5px graphite outline with round
 * joins, fills from the --illo-* palette, one white highlight, a soft ground
 * shadow. The stage behind the art supplies the background.
 */
const illustrations = {
  umbrella: Umbrella,
  kettle: Kettle,
  lighthouse: Lighthouse,
  backpack: Backpack,
  key: Key,
};

export type IllustrationId = keyof typeof illustrations;

interface IllustrationProps {
  id: IllustrationId;
  alt: string;
  className?: string;
}

export function Illustration({ id, alt, className }: IllustrationProps) {
  const Art = illustrations[id];
  return (
    <svg viewBox="0 0 240 240" role="img" aria-label={alt} lang="en" className={className}>
      <g stroke="var(--illo-line)" strokeWidth={5} strokeLinejoin="round" strokeLinecap="round">
        <Art />
      </g>
    </svg>
  );
}
