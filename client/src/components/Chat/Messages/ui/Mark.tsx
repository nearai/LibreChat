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

/** The NEAR AI mark at full resolution, in the tile's coordinates (the same artwork as
 *  `/assets/nearai-mark.svg`), which the marker line and the shine below are measured in. */
const NEAR_MARK =
  'M292.106 82.1357C283.445 82.1357 275.379 86.5848 270.847 93.9047L221.912 165.811C220.318 168.188 220.971 171.382 223.353 172.96C225.292 174.234 227.866 174.082 229.633 172.58L277.799 131.227C278.605 130.504 279.834 130.581 280.545 131.379C280.872 131.74 281.044 132.216 281.044 132.691V262.169C281.044 263.233 280.18 264.089 279.085 264.089C278.509 264.089 277.952 263.842 277.587 263.404L132.014 90.8817C127.271 85.3489 120.318 82.1548 112.982 82.1357H107.893C94.1229 82.1357 82.9648 93.1822 82.9648 106.814V289.167C82.9648 302.799 94.1229 313.846 107.893 313.846C116.554 313.846 124.62 309.397 129.153 302.077L178.087 230.17C179.681 227.793 179.028 224.599 176.646 223.021C174.707 221.747 172.133 221.899 170.366 223.401L122.2 264.754C121.394 265.477 120.165 265.401 119.454 264.602C119.128 264.241 118.955 263.766 118.955 263.29V133.775C118.955 132.71 119.819 131.854 120.914 131.854C121.49 131.854 122.047 132.102 122.412 132.539L267.966 305.1C272.709 310.632 279.662 313.827 286.998 313.846H292.087C305.857 313.846 317.034 302.799 317.034 289.167V106.833C317.034 93.2012 305.876 82.1548 292.106 82.1548V82.1357Z';

/** The marker's center line through the mark (Trace Commons' first run, `GlassBrandMarkDrawing`):
 *  from inside the lower-left hook, down and up the left stem, along the diagonal, up the right
 *  stem and into the upper-right hook. Starting inside the lower hook keeps the pen's round end
 *  off the diagonal beside it. The tip's `offset-path` in style.css is the same line. */
const MARKER_LINE = 'M167.5 234.6L101 312L101 86L299 320L299 84L226 170';

/**
 * The NEAR AI mark drawn like a marker, as the Trace Commons first run opens: a 44-unit pen inks
 * the mark in along its center line with a glowing tip at its front, then a light band crosses
 * it, and again every 15 seconds. The timing and the brand blue live in style.css
 * (`.lc-drawn-mark`); under reduced motion the mark is simply there.
 */
export const DrawnMark = memo(function DrawnMark({ className }: { className?: string }) {
  const id = useId();
  const inkId = `${id}ink`;
  const clipId = `${id}clip`;
  const shineId = `${id}shine`;
  return (
    <svg
      viewBox="82.96 82.13 234.08 231.72"
      aria-hidden="true"
      overflow="visible"
      className={cn('lc-drawn-mark', className)}
    >
      <defs>
        <mask id={inkId}>
          <path
            className="lc-drawn-mark-ink"
            d={MARKER_LINE}
            pathLength={1}
            fill="none"
            strokeWidth={44}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </mask>
        <clipPath id={clipId}>
          <path d={NEAR_MARK} />
        </clipPath>
        <linearGradient id={shineId}>
          <stop className="lc-drawn-mark-light" offset="0" stopOpacity="0" />
          <stop className="lc-drawn-mark-light" offset="0.5" stopOpacity="0.7" />
          <stop className="lc-drawn-mark-light" offset="1" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={NEAR_MARK} fill="currentColor" mask={`url(#${inkId})`} />
      <g clipPath={`url(#${clipId})`}>
        <rect
          className="lc-drawn-mark-shine"
          x="0"
          y="60"
          width="110"
          height="280"
          fill={`url(#${shineId})`}
        />
      </g>
      <circle className="lc-drawn-mark-tip" r="10.5" />
    </svg>
  );
});
