import { memo } from 'react';
import { Loader2, Minus, X } from 'lucide-react';
import { BADGE_16, BADGE_200, CHECK_PATH, sealStrands } from './geometry';
import { cn } from '~/utils';

export type ProofTone = 'positive' | 'caution' | 'critical' | 'neutral';

/**
 * The states a pill or tag glyph moves between. `pending` waits on evidence nobody is
 * fetching yet (a reply the model has not signed); `checking` is a request in flight.
 */
export type GlyphState = 'pending' | 'checking' | 'verified' | 'caution' | 'failed' | 'none';

const badgeFills: Record<ProofTone, string> = {
  positive: 'fill-status-success-strong',
  caution: 'fill-status-warning-strong',
  critical: 'fill-status-error-strong',
  neutral: 'fill-status-neutral',
};

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

/**
 * The mark inside a proof pill or tag. While checking it is a ring of segments, one per
 * check; when the evidence verifies, the segments fade and the badge springs in.
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
  const sealed = state === 'verified' || state === 'caution';
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
            (sealed || state === 'none') && 'opacity-0',
            state === 'pending' && 'animate-pulse motion-reduce:animate-none',
          )}
        />
      ))}
      <path
        d={BADGE_200}
        className={cn(
          ownBox,
          'ease-proof-spring transition-all duration-300 motion-reduce:transition-none',
          state === 'caution' ? badgeFills.caution : badgeFills.positive,
          sealed ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
        )}
      />
      {sealed && (
        <path
          d={CHECK_PATH}
          transform="translate(-100 -100) scale(12.5)"
          strokeWidth={1.8}
          className="stroke-text-on-status"
        />
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

const strandStrokes: Record<ProofTone, [string, string]> = {
  positive: ['stroke-status-success-strong', 'stroke-status-info'],
  caution: ['stroke-status-warning-strong', 'stroke-status-warning-strong'],
  critical: ['stroke-status-error-strong', 'stroke-status-error-strong'],
  neutral: ['stroke-status-neutral', 'stroke-status-neutral'],
};

const centerColors: Record<ProofTone, string> = {
  positive: 'text-status-success',
  caution: 'text-status-warning',
  critical: 'text-status-error',
  neutral: 'text-text-secondary',
};

/** The filled badge with its check, in a 16-unit box. */
function Badge({ tone }: { tone: ProofTone }) {
  return (
    <>
      <path d={BADGE_16} className={badgeFills[tone]} />
      <path
        d={CHECK_PATH}
        fill="none"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-text-on-status"
      />
    </>
  );
}

/**
 * The seal at popover size: two woven strands and three petals drawn from `sealKey`
 * around the badge. Without a key it draws a dashed ring, so an unproven state never
 * borrows a seal it has not earned.
 */
export const SealMark = memo(function SealMark({
  sealKey,
  tone,
  center,
  size = 56,
}: {
  sealKey?: string;
  tone: ProofTone;
  center: 'badge' | 'spinner' | 'cross' | 'dash';
  size?: number;
}) {
  const strands = sealKey ? sealStrands(sealKey) : undefined;
  const [bandStroke, roseStroke] = strandStrokes[tone];
  const glyph = 'size-4';
  return (
    <div
      aria-hidden="true"
      className="animate-proof-stamp relative shrink-0 motion-reduce:animate-none"
      style={{ width: size, height: size }}
    >
      <svg viewBox="-100 -100 200 200" fill="none" className="size-full overflow-visible">
        {strands ? (
          <>
            <path
              d={strands.band}
              strokeWidth={0.9}
              vectorEffect="non-scaling-stroke"
              className={bandStroke}
            />
            <path
              d={strands.rose}
              strokeWidth={0.9}
              vectorEffect="non-scaling-stroke"
              className={roseStroke}
            />
          </>
        ) : (
          <circle
            r="84"
            strokeWidth={1.2}
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
            className="stroke-border-medium"
          />
        )}
      </svg>
      <div
        className={cn(
          'absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2',
          centerColors[tone],
        )}
      >
        {center === 'badge' && (
          <svg viewBox="0 0 16 16" style={{ width: size * 0.4, height: size * 0.4 }}>
            <Badge tone={tone} />
          </svg>
        )}
        {center === 'spinner' && (
          <Loader2 className={cn(glyph, 'animate-spin motion-reduce:animate-none')} />
        )}
        {center === 'cross' && <X className={glyph} strokeWidth={2.4} />}
        {center === 'dash' && <Minus className={glyph} strokeWidth={2.4} />}
      </div>
    </div>
  );
});

/** The filled badge alone, for inline use beside a seal code. */
export function SealBadge({
  tone = 'positive',
  className,
}: {
  tone?: ProofTone;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={cn('shrink-0', className)}>
      <Badge tone={tone} />
    </svg>
  );
}
