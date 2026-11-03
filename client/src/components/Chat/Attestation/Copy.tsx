import { useEffect, useState } from 'react';
import copy from 'copy-to-clipboard';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

/** A small pill that copies `value` and says so for a moment. */
export default function Copy({
  value,
  label,
  className,
}: {
  value: string;
  /** Names what is copied, for screen readers. */
  label: string;
  className?: string;
}) {
  const localize = useLocalize();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        copy(value);
        setCopied(true);
      }}
      className={cn(
        'bg-status-neutral-subtle text-text-secondary hover:text-text-primary focus-visible:ring-focus-control h-5 shrink-0 rounded-full px-2 text-xs font-semibold focus-visible:ring-2 focus-visible:outline-hidden',
        className,
      )}
    >
      <span aria-live="polite">{copied ? localize('com_ui_copied') : localize('com_ui_copy')}</span>
    </button>
  );
}
