import { memo, useCallback, useRef, useState } from 'react';
import { OGDialog, TooltipAnchor, useTheme } from '@librechat/client';
import { ShieldAlert, ShieldCheck, ShieldHalf, ShieldQuestion } from 'lucide-react';
import type { TMessage, TNearAIReceipt } from 'librechat-data-provider';
import { hoverButtonClasses } from '~/components/Chat/Messages/styles';
import Verification from './Verification';
import { getReceipts } from './reports';
import { useLocalize } from '~/hooks';

type SignatureState = 'model' | 'gateway' | 'unverified' | 'failed';

const icons = {
  model: ShieldCheck,
  gateway: ShieldHalf,
  unverified: ShieldQuestion,
  failed: ShieldAlert,
} as const;
const labels = {
  model: 'com_ui_nearai_signature_model',
  gateway: 'com_ui_nearai_signature_gateway',
  unverified: 'com_ui_nearai_signature_unverified',
  failed: 'com_ui_nearai_signature_failed',
} as const;

const iconColors: Record<SignatureState, string> = {
  model: 'text-status-success',
  gateway: 'text-status-warning',
  unverified: 'text-text-secondary',
  failed: 'text-status-error',
};

function getState(receipts: TNearAIReceipt[]): SignatureState {
  const unverified = receipts.filter((receipt) => receipt.status !== 'verified');
  // A timeout or missing evidence is not a rejected signature.
  if (unverified.some((receipt) => receipt.report?.status !== 'unverifiable')) {
    return 'failed';
  }
  if (unverified.length > 0) {
    return 'unverified';
  }
  if (receipts.some((receipt) => receipt.signatureKind !== 'provider_tee')) {
    return 'gateway';
  }
  return 'model';
}

function Signature({ message, isLast }: { message: TMessage; isLast: boolean }) {
  const localize = useLocalize();
  const { resolvedMode } = useTheme();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    // Programmatic iframe closes bypass OGDialog's trigger-focus handler.
    setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);
  const receipts = getReceipts(message);
  if (receipts.length === 0) {
    return null;
  }

  const state = getState(receipts);
  const label = localize(labels[state]);
  const Icon = icons[state];

  return (
    <>
      <TooltipAnchor
        description={label}
        render={
          <button
            ref={triggerRef}
            type="button"
            aria-label={label}
            aria-haspopup="dialog"
            aria-expanded={open}
            data-testid="nearai-signature-button"
            className={hoverButtonClasses({ isActive: open, isLast })}
            onClick={() => setOpen(true)}
          >
            <Icon size="19" aria-hidden="true" className={iconColors[state]} />
          </button>
        }
      />
      <OGDialog open={open} onOpenChange={setOpen} triggerRef={triggerRef}>
        {open && (
          <Verification
            endpoint={message.endpoint}
            receipts={receipts}
            darkMode={resolvedMode === 'dark'}
            onClose={close}
          />
        )}
      </OGDialog>
    </>
  );
}

export default memo(Signature);
