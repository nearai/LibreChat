import { memo } from 'react';
import { Check, Loader2, Minus, X } from 'lucide-react';
import type { CheckState } from './proof';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export type CheckRow = {
  id: string;
  state: CheckState;
  title: string;
  caption: string;
};

const dotClasses: Record<CheckState, string> = {
  done: 'bg-status-success-subtle text-status-success',
  active: 'text-text-secondary',
  fail: 'bg-status-error-subtle text-status-error ring-1 ring-inset ring-status-error',
  warn: 'bg-status-warning-subtle text-status-warning',
  skip: 'bg-status-neutral-subtle text-text-secondary',
};

function Dot({ state }: { state: CheckState }) {
  const icon = 'size-3';
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-full',
        dotClasses[state],
      )}
    >
      {state === 'done' && <Check className={icon} strokeWidth={3} />}
      {state === 'active' && (
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={2} />
      )}
      {state === 'fail' && <X className={icon} strokeWidth={3} />}
      {state === 'warn' && <span className="text-xs leading-none font-bold">!</span>}
      {state === 'skip' && <Minus className={icon} strokeWidth={3} />}
    </span>
  );
}

const stateLabels = {
  done: 'com_ui_nearai_check_passed',
  active: 'com_ui_nearai_check_running',
  fail: 'com_ui_nearai_check_failed',
  warn: 'com_ui_nearai_check_warning',
  skip: 'com_ui_nearai_check_skipped',
} as const;

/** The checks behind a proof, one row each, with the state as text for screen readers. */
function CheckList({ rows }: { rows: CheckRow[] }) {
  const localize = useLocalize();
  return (
    <ul className="bg-surface-primary rounded-xl px-3 py-0.5">
      {rows.map((row, index) => (
        <li
          key={row.id}
          className={cn(
            'animate-proof-row flex items-center gap-2.5 py-2 motion-reduce:animate-none',
            index > 0 && 'border-border-light border-t',
            row.state === 'skip' && 'opacity-60',
          )}
        >
          <Dot state={row.state} />
          <div className="min-w-0 flex-1">
            <div className="text-text-primary text-sm leading-4.75 font-semibold">
              {row.title}
              <span className="sr-only">: {localize(stateLabels[row.state])}</span>
            </div>
            <div className="text-text-secondary text-xs leading-4">{row.caption}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default memo(CheckList);
