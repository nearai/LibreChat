import { memo } from 'react';
import { BADGE_200, DASH_PATH, CHECK_PATH, CLOCK_PATH, CROSS_PATH, PENCIL_PATH } from './geometry';
import { cn } from '~/utils';

/** `none` has no seal to show: it draws a dashed ring instead. */
export type SealTone = 'positive' | 'caution' | 'critical' | 'neutral' | 'none';

export type SealGlyph = 'check' | 'clock' | 'pencil' | 'cross' | 'dash' | 'spinner';

/**
 * The states a pill or tag glyph moves between. `pending` waits on evidence nobody is
 * fetching yet (a reply whose signature has not arrived); `checking` is a request in flight.
 */
export type GlyphState =
  | 'pending'
  | 'checking'
  | 'verified'
  | 'gateway'
  | 'edited'
  | 'failed'
  | 'none';

/** Arcs around the badge, one per check: four for a deployment, three for a reply. */
const segmentPaths: Record<3 | 4, string[]> = {
  4: [
    'M9.4 -89.5A90 90 0 0 1 89.5 -9.4',
    'M89.5 9.4A90 90 0 0 1 9.4 89.5',
    'M-9.4 89.5A90 90 0 0 1 -89.5 9.4',
    'M-89.5 -9.4A90 90 0 0 1 -9.4 -89.5',
  ],
  3: [
    'M12.5 -89.1A90 90 0 0 1 83.4 33.7',
    'M70.9 55.4A90 90 0 0 1 -70.9 55.4',
    'M-83.4 33.7A90 90 0 0 1 -12.5 -89.1',
  ],
};

/** Fills on SVG paths scale about their own box rather than the viewBox origin. */
const ownBox = 'origin-center [transform-box:fill-box]';

/** Moves a glyph from the badge's 16-unit box into the 200-unit box around the origin. */
const BADGE_BOX = 'translate(-100 -100) scale(12.5)';

/**
 * The mark inside a proof pill or tag. While checking it is a ring of segments, one per
 * check; when the evidence verifies, the segments fade and the badge springs in. A reply
 * only the Gateway signed shows a clock with no badge.
 */
export const ProofGlyph = memo(function ProofGlyph({
  state,
  segments = 4,
  failedSegment,
  className,
}: {
  state: GlyphState;
  segments?: 3 | 4;
  failedSegment?: number;
  className?: string;
}) {
  const sealed = state === 'verified' || state === 'edited';
  return (
    <svg
      viewBox="-100 -100 200 200"
      aria-hidden="true"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('shrink-0', className)}
    >
      {segmentPaths[segments].map((d, i) => (
        <path
          key={d}
          d={d}
          strokeWidth={segments === 4 ? 12 : 16}
          className={cn(
            'transition-all duration-200 motion-reduce:transition-none',
            state === 'failed' && i === failedSegment
              ? 'stroke-status-error-strong'
              : 'stroke-border-medium',
            (sealed || state === 'gateway' || state === 'none') && 'opacity-0',
            state === 'pending' && 'animate-pulse motion-reduce:animate-none',
          )}
        />
      ))}
      <path
        d={BADGE_200}
        className={cn(
          ownBox,
          'ease-proof-spring transition-all duration-300 motion-reduce:transition-none',
          state === 'edited' ? 'fill-status-warning-strong' : 'fill-status-success-strong',
          sealed ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
        )}
      />
      {state === 'verified' && (
        <path
          d={CHECK_PATH}
          transform={BADGE_BOX}
          strokeWidth={1.8}
          className="stroke-text-on-status"
        />
      )}
      {state === 'edited' && (
        <path
          d={PENCIL_PATH}
          transform={BADGE_BOX}
          strokeWidth={1.3}
          className="stroke-text-on-status"
        />
      )}
      {state === 'gateway' && (
        <g transform={BADGE_BOX} stroke="currentColor" strokeWidth={2}>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 5.2v3l2 1.4" />
        </g>
      )}
      {state === 'checking' && (
        <g transform="translate(-48 -48) scale(6)">
          <path
            d="M8 3.5a4.5 4.5 0 1 1-4.5 4.5"
            stroke="currentColor"
            strokeWidth={2}
            className={cn(ownBox, 'animate-spin motion-reduce:animate-none')}
          />
        </g>
      )}
      {state === 'failed' && (
        <path
          d="M5 5l6 6M11 5l-6 6"
          transform="translate(-48 -48) scale(6)"
          stroke="currentColor"
          strokeWidth={2.2}
        />
      )}
      {state === 'none' && (
        <path
          d="M4.5 8h7"
          transform="translate(-48 -48) scale(6)"
          stroke="currentColor"
          strokeWidth={2.2}
        />
      )}
    </svg>
  );
});

const sealStyles: Record<Exclude<SealTone, 'none'>, string> = {
  positive: 'fill-status-success-strong',
  caution: 'fill-status-warning-strong',
  critical: 'fill-status-error-subtle stroke-status-error-strong',
  neutral: 'fill-status-neutral-subtle stroke-status-neutral',
};

const glyphColors: Record<SealTone, string> = {
  positive: 'text-text-on-status',
  caution: 'text-text-on-status',
  critical: 'text-status-error',
  neutral: 'text-text-secondary',
  none: 'text-text-secondary',
};

const sealGlyphs: Record<Exclude<SealGlyph, 'spinner'>, { d: string; width: number }> = {
  check: { d: CHECK_PATH, width: 1.4 },
  clock: { d: CLOCK_PATH, width: 1 },
  pencil: { d: PENCIL_PATH, width: 1 },
  cross: { d: CROSS_PATH, width: 1.4 },
  dash: { d: DASH_PATH, width: 1.4 },
};

/** The fixed seal at popover size, with the glyph that says what its status is. */
export const SealMark = memo(function SealMark({
  tone,
  glyph,
  size = 40,
}: {
  tone: SealTone;
  glyph: SealGlyph;
  size?: number;
}) {
  return (
    <svg
      viewBox="-100 -100 200 200"
      aria-hidden="true"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('animate-proof-stamp shrink-0 motion-reduce:animate-none', glyphColors[tone])}
      style={{ width: size, height: size }}
    >
      {tone === 'none' ? (
        <circle
          r="84"
          strokeWidth={1.2}
          strokeDasharray="3 4"
          vectorEffect="non-scaling-stroke"
          className="stroke-border-medium"
        />
      ) : (
        <path
          d={BADGE_200}
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
          className={sealStyles[tone]}
        />
      )}
      {glyph === 'spinner' ? (
        <g transform="translate(-40 -40) scale(5)">
          <path
            d="M8 2.5a5.5 5.5 0 1 1-5.5 5.5"
            stroke="currentColor"
            strokeWidth={1.8}
            className={cn(ownBox, 'animate-spin motion-reduce:animate-none')}
          />
        </g>
      ) : (
        <path
          d={sealGlyphs[glyph].d}
          transform={BADGE_BOX}
          stroke="currentColor"
          strokeWidth={sealGlyphs[glyph].width}
        />
      )}
    </svg>
  );
});
