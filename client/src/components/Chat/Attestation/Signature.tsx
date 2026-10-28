import { memo, useCallback, useRef, useState } from 'react';
import { ShieldAlert, ShieldCheck, ShieldHalf } from 'lucide-react';
import { OGDialog, TooltipAnchor, useTheme } from '@librechat/client';
import type { TMessage, TNearAIReceipt } from 'librechat-data-provider';
import { hoverButtonClasses } from '~/components/Chat/Messages/styles';
import Verification from './Verification';
import { useLocalize } from '~/hooks';

type SignatureState = 'model' | 'gateway' | 'failed';

const icons = { model: ShieldCheck, gateway: ShieldHalf, failed: ShieldAlert } as const;

const iconColors: Record<SignatureState, string> = {
  model: 'text-status-success',
  gateway: 'text-status-warning',
  failed: 'text-status-error',
};

function getReceipts(message: TMessage): TNearAIReceipt[] {
  if (
    message.isUserSubmitted ||
    message.userSubmittedPaths?.length ||
    message.userSubmittedMessageFieldPaths?.length
  ) {
    return [];
  }
  const nearai = message.metadata?.nearai as { receipts?: TNearAIReceipt[] } | undefined;
  return Array.isArray(nearai?.receipts) ? nearai.receipts : [];
}

function getState(receipts: TNearAIReceipt[]): SignatureState {
  if (receipts.some((receipt) => receipt.status !== 'verified')) {
    return 'failed';
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
  const label = localize(`com_ui_nearai_signature_${state}`);
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
