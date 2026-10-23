import { memo } from 'react';
import * as Ariakit from '@ariakit/react';
import { TooltipAnchor } from '@librechat/client';
import { ExternalLink, ShieldAlert, ShieldCheck, ShieldHalf } from 'lucide-react';
import type { TMessage, TNearAIReceipt } from 'librechat-data-provider';
import { useNearAIAttestationQuery } from '~/data-provider/Misc/queries';
import { hoverButtonClasses } from '~/components/Chat/Messages/styles';
import { receiptVerifyLink } from './links';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type SignatureState = 'model' | 'gateway' | 'failed';

const icons = { model: ShieldCheck, gateway: ShieldHalf, failed: ShieldAlert } as const;

const iconColors: Record<SignatureState, string> = {
  model: 'text-status-success',
  gateway: 'text-status-warning',
  failed: 'text-status-error',
};

function getReceipts(message: TMessage): TNearAIReceipt[] {
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

function Field({ label, value }: { label: string; value?: string }) {
  if (!value) {
    return null;
  }
  return (
    <>
      <dt className="text-text-secondary">{label}</dt>
      <dd className="font-mono break-all">{value}</dd>
    </>
  );
}

/** Per-reply shield: the server checked each completion's signature against the exact bytes. */
function Signature({ message, isLast }: { message: TMessage; isLast: boolean }) {
  const localize = useLocalize();
  const popover = Ariakit.usePopoverStore({ placement: 'bottom-start' });
  const open = Ariakit.useStoreState(popover, 'open');
  const receipts = getReceipts(message);
  /** Only fetched once the popover opens, for the verify page link. */
  const { data: attestation } = useNearAIAttestationQuery(
    { endpoint: message.endpoint ?? '', model: receipts[0]?.model ?? '' },
    { enabled: open && receipts.length > 0, staleTime: 5 * 60 * 1000 },
  );
  const verifyUrl = attestation?.enabled === true ? attestation.verifyUrl : undefined;
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
          <Ariakit.PopoverDisclosure
            store={popover}
            aria-label={label}
            data-testid="nearai-signature-button"
            className={hoverButtonClasses({ isActive: open, isLast })}
          >
            <Icon size="19" aria-hidden="true" className={iconColors[state]} />
          </Ariakit.PopoverDisclosure>
        }
      />
      <Ariakit.Popover
        store={popover}
        gutter={8}
        portal
        unmountOnHide
        className="popover-animate border-border-medium bg-surface-secondary text-text-primary rounded-theme-popover z-[200] flex w-[26rem] max-w-[calc(100vw-2rem)] flex-col gap-3 border p-3 shadow-lg"
      >
        <div className="flex items-center gap-2">
          <Icon className={cn('size-5 shrink-0', iconColors[state])} aria-hidden="true" />
          <Ariakit.PopoverHeading className="text-sm font-semibold">{label}</Ariakit.PopoverHeading>
        </div>
        <p className="text-text-secondary text-sm">
          {localize(`com_ui_nearai_signature_${state}_desc`)}
        </p>
        {receipts.map((receipt) => (
          <dl
            key={receipt.completionId}
            className="border-border-light grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t pt-2 text-xs"
          >
            <Field
              label={localize('com_ui_nearai_signature_completion')}
              value={receipt.completionId}
            />
            <Field
              label={localize('com_ui_nearai_signature_scope')}
              value={
                receipt.signatureKind === 'provider_tee'
                  ? localize('com_ui_nearai_signature_scope_model')
                  : receipt.signatureKind && localize('com_ui_nearai_signature_scope_gateway')
              }
            />
            <Field
              label={localize('com_ui_nearai_signature_algorithm')}
              value={receipt.signingAlgo}
            />
            <Field
              label={localize('com_ui_nearai_signature_signer')}
              value={receipt.signingAddress}
            />
            <Field label={localize('com_ui_nearai_signature_signed')} value={receipt.signedText} />
            <Field label={localize('com_ui_nearai_signature_value')} value={receipt.signature} />
            <Field label={localize('com_ui_nearai_shield_error')} value={receipt.errorCode} />
            <Field
              label={localize('com_ui_nearai_signature_verified_at')}
              value={new Date(receipt.verifiedAt).toLocaleString()}
            />
            {verifyUrl && receiptVerifyLink(verifyUrl, receipt) && (
              <a
                href={receiptVerifyLink(verifyUrl, receipt)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-primary col-span-2 mt-1 inline-flex items-center gap-1.5 text-sm font-medium underline-offset-2 hover:underline"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                {localize('com_ui_nearai_view_details')}
              </a>
            )}
          </dl>
        ))}
      </Ariakit.Popover>
    </>
  );
}

export default memo(Signature);
