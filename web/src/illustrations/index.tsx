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

/** Content may name an illustration the app does not have (yet); callers fall back to text. */
export const isIllustrationId = (id: string | null | undefined): id is IllustrationId =>
  id != null && Object.hasOwn(illustrations, id);

interface IllustrationProps {
  id: IllustrationId;
  /** Omit when the word is already shown in text; the art is then hidden from screen readers. */
  alt?: string;
  className?: string;
}

export function Illustration({ id, alt, className }: IllustrationProps) {
  const Art = illustrations[id];
  return (
    <svg
      viewBox="0 0 240 240"
      className={className}
      {...(alt ? { role: 'img', 'aria-label': alt, lang: 'en' } : { 'aria-hidden': true })}
    >
      <g stroke="var(--illo-line)" strokeWidth={5} strokeLinejoin="round" strokeLinecap="round">
        <Art />
      </g>
    </svg>
  );
}
