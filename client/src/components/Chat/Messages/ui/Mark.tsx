import { memo, useId } from 'react';
import { cn } from '~/utils';

/** The NEAR "N" on a 24 grid, from Ironclaw's web UI (near-process-indicator.tsx, MIT, NEAR AI).
 *  It is the filled base and, while working, the clip that keeps the light inside the letter. */
const NEAR_GLYPH =
  'M21.443 0c-.89 0-1.714.46-2.18 1.218l-5.017 7.448a.533.533 0 0 0 .792.7l4.938-4.282a.2.2 0 0 1 .334.151v13.41a.2.2 0 0 1-.354.128L5.03.905A2.555 2.555 0 0 0 3.078 0h-.521A2.557 2.557 0 0 0 0 2.557v18.886a2.557 2.557 0 0 0 4.736 1.338l5.017-7.448a.533.533 0 0 0-.792-.7l-4.938 4.283a.2.2 0 0 1-.333-.152V5.352a.2.2 0 0 1 .354-.128l14.924 17.87c.486.574 1.2.905 1.952.906h.521A2.558 2.558 0 0 0 24 21.445V2.557A2.558 2.558 0 0 0 21.443 0Z';

/** The path the light travels: down the left stroke, up the diagonal, up the right stroke. */
const NEAR_SPINE = 'M2.6 22.2V2.4L21.4 21.6V1.8';

/**
 * NEAR's process mark: while `working`, the N dims and a light chases its spine as the glyph
 * turns and beats; at rest it is the solid mark. The motion and the brand blue live in style.css
 * (`.lc-near-mark`), and nothing moves under reduced motion. Rendered with `lc-live-mark`, it
 * stands in for a live glyph only for a brand that chooses it.
 */
export const ProcessMark = memo(function ProcessMark({
  working = false,
  className,
}: {
  working?: boolean;
  className?: string;
}) {
  const clipId = useId();
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn('lc-near-mark', working && 'is-working', className)}
    >
      {working && (
        <defs>
          <clipPath id={clipId}>
            <path d={NEAR_GLYPH} />
          </clipPath>
        </defs>
      )}
      <path className="lc-near-mark-base" d={NEAR_GLYPH} />
      {working && (
        <g clipPath={`url(#${clipId})`}>
          <path className="lc-near-mark-light" d={NEAR_SPINE} />
        </g>
      )}
    </svg>
  );
});

/**
 * The working mark in the waiting dot's place. The dot (`.result-thinking` in style.css) is drawn
 * 11px above its line, so the mark goes just before the dot's span, inside the same positioned
 * line, and centers on it.
 */
export function WaitMark() {
  return <ProcessMark working className="lc-live-mark absolute -top-3.25 -left-0.5 size-4" />;
}
