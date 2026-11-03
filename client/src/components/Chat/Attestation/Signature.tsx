import { memo, useEffect, useId, useRef, useState } from 'react';
import { useSetAtom } from 'jotai';
import * as Ariakit from '@ariakit/react';
import { buttonVariants } from '@librechat/client';
import { ArrowUpRight, ChevronRight, X } from 'lucide-react';
import type { TMessage, TNearAIReceipt, TNearAIAttestationResponse } from 'librechat-data-provider';
import type { GlyphState, ProofTone } from './Seal';
import type { CheckRow } from './CheckList';
import type { ReplyState } from './proof';
import {
  sameKey,
  replyState,
  getReceipts,
  replyChecks,
  replySealKey,
  formatCheckedAt,
} from './proof';
import { useNearAIAttestationQuery } from '~/data-provider/Misc/queries';
import { proofPulseAtom, useHeaderSealKey } from './state';
import { ProofGlyph, SealBadge, SealMark } from './Seal';
import { receiptVerifyLink } from './links';
import { sealCode } from './geometry';
import { useLocalize } from '~/hooks';
import CheckList from './CheckList';
import { cn } from '~/utils';
import Copy from './Copy';

type TagState = ReplyState | 'signing';

/** Receipts this young arrived with the reply rather than from history. */
const FRESH_RECEIPT_MS = 15_000;

function isRecent(iso?: string): boolean {
  const at = Date.parse(iso ?? '');
  return Number.isFinite(at) && Date.now() - at < FRESH_RECEIPT_MS;
}

const tagTones: Record<TagState, string> = {
  signing: 'bg-status-neutral-subtle text-text-secondary',
  verified: 'bg-status-proof-subtle text-status-proof',
  gateway: 'bg-status-warning-subtle text-status-warning',
  failed: 'bg-status-error-subtle text-status-error ring-1 ring-inset ring-status-error',
};

const glyphStates: Record<TagState, GlyphState> = {
  signing: 'pending',
  verified: 'verified',
  gateway: 'caution',
  failed: 'failed',
};

const sealTones: Record<ReplyState, ProofTone> = {
  verified: 'positive',
  gateway: 'caution',
  failed: 'critical',
};

const titleColors: Record<ReplyState, string> = {
  verified: 'text-status-proof',
  gateway: 'text-status-warning',
  failed: 'text-status-error',
};

const words = {
  signing: 'com_ui_nearai_reply_signing',
  verified: 'com_ui_nearai_proof_verified',
  gateway: 'com_ui_nearai_reply_gateway',
  failed: 'com_ui_nearai_proof_failed',
} as const;

const titles = {
  verified: 'com_ui_nearai_reply_verified_title',
  gateway: 'com_ui_nearai_reply_gateway_title',
  failed: 'com_ui_nearai_proof_failed',
} as const;

const bodies = {
  verified: 'com_ui_nearai_reply_verified_body',
  gateway: 'com_ui_nearai_reply_gateway_body',
  failed: 'com_ui_nearai_reply_failed_body',
} as const;

/**
 * Proof under a reply. The server checked each completion's signature against the exact
 * request and response bytes and saved the receipts on the reply; while a NEAR AI reply
 * is still streaming, the tag waits as "Signing" and settles when the receipts land.
 */
function Signature({
  message,
  conversation,
  isStreaming,
}: {
  message: TMessage;
  /** The chat's endpoint and model; a custom endpoint's name is any string. */
  conversation: { endpoint?: string | null; model?: string | null };
  isStreaming: boolean;
}) {
  const localize = useLocalize();
  const popover = Ariakit.usePopoverStore({ placement: 'bottom-start' });
  const open = Ariakit.useStoreState(popover, 'open');
  const receipts = getReceipts(message);
  const awaitingReceipts = receipts.length === 0 && isStreaming;

  /** Whether this endpoint is NEAR AI while the reply streams, and the verify page once opened. */
  const { data: attestation } = useNearAIAttestationQuery(
    awaitingReceipts
      ? { endpoint: conversation.endpoint ?? '', model: conversation.model ?? '' }
      : { endpoint: message.endpoint ?? '', model: receipts[0]?.model ?? '' },
    {
      enabled: awaitingReceipts || (open && receipts.length > 0),
      staleTime: 5 * 60 * 1000,
      refetchInterval: false,
      refetchOnWindowFocus: false,
    },
  );

  let state: TagState | undefined;
  if (receipts.length > 0) {
    state = replyState(receipts);
  } else if (awaitingReceipts && attestation?.enabled === true) {
    state = 'signing';
  }

  /**
   * The shine plays when receipts land under a tag that was waiting for them, or that
   * were verified moments ago (the reply's row can remount as the final message lands).
   */
  const justVerified = isRecent(receipts[0]?.verifiedAt);
  const wasSigning = useRef(false);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (state === 'signing') {
      wasSigning.current = true;
      return;
    }
    if (state === 'verified' && (wasSigning.current || justVerified)) {
      setFresh(true);
    }
    wasSigning.current = false;
  }, [state, justVerified]);

  if (!state) {
    return null;
  }

  const word = localize(words[state]);

  return (
    <span className="mr-1 flex items-center">
      <Ariakit.PopoverDisclosure
        store={popover}
        disabled={state === 'signing'}
        aria-label={localize('com_ui_nearai_reply_aria', { 0: word })}
        data-testid="nearai-signature-button"
        className={cn(
          'relative inline-flex h-6 items-center gap-1.5 overflow-hidden rounded-full pr-2.5 pl-1.5 text-xs font-semibold',
          'transition-colors duration-200 motion-reduce:transition-none',
          'focus-visible:ring-focus-control focus-visible:ring-2 focus-visible:outline-hidden',
          'aria-disabled:cursor-default',
          tagTones[state],
        )}
      >
        <ProofGlyph
          state={glyphStates[state]}
          segments={3}
          failedSegment={0}
          className="size-3.5"
        />
        {word}
        {fresh && (
          <span
            aria-hidden="true"
            className="animate-proof-shine via-text-on-status/70 dark:via-text-on-status/25 pointer-events-none absolute inset-y-0 left-[-40%] w-[34%] -skew-x-12 bg-gradient-to-r from-transparent to-transparent motion-reduce:hidden"
          />
        )}
      </Ariakit.PopoverDisclosure>
      <span aria-hidden="true" className="bg-border-light ml-2 h-4 w-px" />
      {state !== 'signing' && (
        <Ariakit.Popover
          store={popover}
          gutter={8}
          portal
          unmountOnHide
          fitViewport
          className="popover-animate border-border-light bg-surface-secondary text-text-primary rounded-theme-popover z-[200] flex max-h-[var(--popover-available-height)] w-[24.75rem] max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto overscroll-contain border p-4 shadow-lg focus:outline-none"
        >
          <ReplyDetails
            state={state}
            message={message}
            receipts={receipts}
            conversationModel={conversation.model ?? ''}
            attestation={attestation}
          />
        </Ariakit.Popover>
      )}
    </span>
  );
}

function ReplyDetails({
  state,
  message,
  receipts,
  conversationModel,
  attestation,
}: {
  state: ReplyState;
  message: TMessage;
  receipts: TNearAIReceipt[];
  conversationModel: string;
  /** The deployment answer for this reply's endpoint and model. */
  attestation?: TNearAIAttestationResponse;
}) {
  const localize = useLocalize();
  const setPulse = useSetAtom(proofPulseAtom);
  const model = receipts[0]?.model ?? '';
  const key = replySealKey(receipts);
  /** The header seal is drawn for the conversation's model; another model's reply has no match. */
  const headerKey = useHeaderSealKey(
    model === conversationModel ? message.conversationId : null,
    model,
    attestation,
  );
  const verifyUrl = attestation?.enabled === true ? attestation.verifyUrl : undefined;
  const when = formatCheckedAt(receipts[0]?.verifiedAt);
  const link = verifyUrl
    ? receipts.map((receipt) => receiptVerifyLink(verifyUrl, receipt)).find(Boolean)
    : undefined;

  const checks = replyChecks(state);
  const algo = receipts.find((receipt) => receipt.signingAlgo)?.signingAlgo;
  const notRun = localize('com_ui_nearai_check_not_run');

  let signatureCaption = localize('com_ui_nearai_check_signature_caption_plain');
  if (checks.signature === 'fail') {
    signatureCaption = localize('com_ui_nearai_check_signature_failed_caption');
  } else if (algo) {
    signatureCaption = localize('com_ui_nearai_check_signature_caption', {
      0: algo.toUpperCase(),
    });
  }

  let signerCaption = localize('com_ui_nearai_check_signer_caption');
  if (checks.signer === 'skip') {
    signerCaption = notRun;
  } else if (state === 'gateway') {
    signerCaption = localize('com_ui_nearai_check_signer_gateway_caption');
  }

  const rows: CheckRow[] = [
    {
      id: 'signature',
      state: checks.signature,
      title:
        checks.signature === 'fail'
          ? localize('com_ui_nearai_check_signature_failed')
          : localize('com_ui_nearai_check_signature'),
      caption: signatureCaption,
    },
    {
      id: 'signer',
      state: checks.signer,
      title:
        state === 'gateway'
          ? localize('com_ui_nearai_check_signer_gateway')
          : localize('com_ui_nearai_check_signer'),
      caption: signerCaption,
    },
    {
      id: 'model',
      state: checks.model,
      title: localize('com_ui_nearai_check_model', { 0: model }),
      caption: checks.model === 'skip' ? notRun : localize('com_ui_nearai_check_model_caption'),
    },
  ];

  return (
    <>
      <div className="flex items-start gap-3">
        <SealMark
          sealKey={state === 'failed' ? undefined : key}
          tone={sealTones[state]}
          center={state === 'failed' ? 'cross' : 'badge'}
          size={44}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
          <Ariakit.PopoverHeading
            className={cn('text-base leading-5.25 font-bold', titleColors[state])}
          >
            {localize(titles[state])}
          </Ariakit.PopoverHeading>
          {when && (
            <p className="text-text-secondary text-xs leading-4">
              {when.justNow
                ? localize('com_ui_nearai_checked_just_now')
                : localize('com_ui_nearai_checked_at', { 0: when.label })}
            </p>
          )}
        </div>
        <Ariakit.PopoverDismiss
          aria-label={localize('com_ui_close')}
          className="text-text-secondary hover:bg-surface-hover focus-visible:ring-focus-control flex size-7 shrink-0 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-hidden"
        >
          <X className="size-3.5" aria-hidden="true" />
        </Ariakit.PopoverDismiss>
      </div>

      <p className="text-sm leading-5">{localize(bodies[state])}</p>

      <CheckList rows={rows} />

      {state === 'verified' && key && headerKey && (
        <SealMatch
          sealKey={key}
          matches={sameKey(headerKey, key)}
          onShow={() => setPulse((n) => n + 1)}
        />
      )}

      <ProofData receipts={receipts} />

      {link && (
        <div className="flex justify-end">
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: 'submit', size: 'sm', shape: 'round' })}
          >
            {localize('com_ui_nearai_verify_on')}
            <ArrowUpRight aria-hidden="true" className="size-3.5" />
            <span className="sr-only">{localize('com_ui_nearai_opens_nearai')}</span>
          </a>
        </div>
      )}
    </>
  );
}

/** Lines this reply's seal up with the header's, or says plainly that they differ. */
function SealMatch({
  sealKey,
  matches,
  onShow,
}: {
  sealKey: string;
  matches: boolean;
  onShow: () => void;
}) {
  const localize = useLocalize();
  const code = (
    <b className="font-mono">{localize('com_ui_nearai_seal_code', { 0: sealCode(sealKey) })}</b>
  );
  if (!matches) {
    return (
      <p className="bg-status-neutral-subtle text-text-secondary rounded-xl px-2.5 py-2 text-xs leading-4">
        {code} {localize('com_ui_nearai_seal_differs_header')}
      </p>
    );
  }
  return (
    <div className="bg-status-proof-subtle text-status-proof flex items-center gap-2 rounded-xl px-2.5 py-2">
      <SealBadge className="size-[18px]" />
      <p className="flex-1 text-xs leading-4">
        {code} {localize('com_ui_nearai_seal_matches_header')}
      </p>
      <button
        type="button"
        onClick={onShow}
        className="focus-visible:ring-focus-control shrink-0 rounded text-xs font-semibold underline underline-offset-2 focus-visible:ring-2 focus-visible:outline-hidden"
      >
        {localize('com_ui_nearai_show_in_header')}
      </button>
    </div>
  );
}

function ProofField({
  label,
  value,
  copyable,
}: {
  label: string;
  value?: string;
  copyable?: boolean;
}) {
  const localize = useLocalize();
  if (!value) {
    return null;
  }
  return (
    <div className="flex items-center gap-2.5 text-xs">
      <dt className="text-text-secondary w-24 shrink-0">{label}</dt>
      <dd className="min-w-0 flex-1 truncate font-mono" title={value}>
        {value}
      </dd>
      {copyable && (
        <Copy value={value} label={localize('com_ui_nearai_copy_field', { 0: label })} />
      )}
    </div>
  );
}

/** The raw receipt fields, folded away until asked for. */
function ProofData({ receipts }: { receipts: TNearAIReceipt[] }) {
  const localize = useLocalize();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="focus-visible:ring-focus-control inline-flex items-center gap-1.5 self-start rounded text-sm font-semibold focus-visible:ring-2 focus-visible:outline-hidden"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            'size-3 transition-transform duration-200 motion-reduce:transition-none',
            open && 'rotate-90',
          )}
          strokeWidth={2.5}
        />
        {localize('com_ui_nearai_proof_data')}
      </button>
      {open && (
        <div id={panelId} className="flex flex-col gap-3">
          {receipts.map((receipt) => (
            <dl key={receipt.completionId} className="flex flex-col gap-1.5">
              <ProofField
                label={localize('com_ui_nearai_signature_completion')}
                value={receipt.completionId}
                copyable
              />
              <ProofField
                label={localize('com_ui_nearai_signature_scope')}
                value={
                  receipt.signatureKind === 'provider_tee'
                    ? localize('com_ui_nearai_signature_scope_model')
                    : receipt.signatureKind && localize('com_ui_nearai_signature_scope_gateway')
                }
              />
              <ProofField
                label={localize('com_ui_nearai_signature_algorithm')}
                value={receipt.signingAlgo}
              />
              <ProofField
                label={localize('com_ui_nearai_signature_signer')}
                value={receipt.signingAddress}
                copyable
              />
              <ProofField
                label={localize('com_ui_nearai_signature_value')}
                value={receipt.signature}
                copyable
              />
              <ProofField
                label={localize('com_ui_nearai_signature_signed')}
                value={receipt.signedText}
                copyable
              />
              <ProofField
                label={localize('com_ui_nearai_shield_error')}
                value={receipt.errorCode}
              />
            </dl>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(Signature);
