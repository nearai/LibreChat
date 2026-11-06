import { memo, useEffect, useId, useRef, useState } from 'react';
import * as Ariakit from '@ariakit/react';
import { buttonVariants } from '@librechat/client';
import { ArrowUpRight, ChevronRight, X } from 'lucide-react';
import type { TMessage, TNearAIReceipt, TNearAIAttestationResponse } from 'librechat-data-provider';
import type { GlyphState, SealGlyph, SealTone } from './Seal';
import type { CheckRow } from './CheckList';
import type { ReplyState } from './proof';
import {
  replyState,
  signerKind,
  getReceipts,
  signedHashes,
  isReplyEdited,
  formatCheckedAt,
} from './proof';
import { useNearAIAttestationQuery } from '~/data-provider/Misc/queries';
import { ProofGlyph, SealMark } from './Seal';
import { receiptVerifyLink } from './links';
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
  edited: 'bg-status-warning-subtle text-status-warning',
  unclassified: 'bg-status-neutral-subtle text-text-secondary',
  unsigned: 'bg-status-neutral-subtle text-text-secondary',
  failed: 'bg-status-error-subtle text-status-error ring-1 ring-inset ring-status-error',
};

const glyphStates: Record<TagState, GlyphState> = {
  signing: 'pending',
  verified: 'verified',
  gateway: 'gateway',
  edited: 'edited',
  unclassified: 'none',
  unsigned: 'none',
  failed: 'failed',
};

const seals: Record<ReplyState, { tone: SealTone; glyph: SealGlyph }> = {
  verified: { tone: 'positive', glyph: 'check' },
  gateway: { tone: 'caution', glyph: 'clock' },
  edited: { tone: 'caution', glyph: 'pencil' },
  unclassified: { tone: 'neutral', glyph: 'dash' },
  unsigned: { tone: 'neutral', glyph: 'dash' },
  failed: { tone: 'critical', glyph: 'cross' },
};

const titleColors: Record<ReplyState, string> = {
  verified: 'text-status-proof',
  gateway: 'text-status-warning',
  edited: 'text-status-warning',
  unclassified: 'text-text-primary',
  unsigned: 'text-text-primary',
  failed: 'text-status-error',
};

const words = {
  signing: 'com_ui_nearai_reply_signing',
  verified: 'com_ui_nearai_reply_model',
  gateway: 'com_ui_nearai_reply_gateway',
  edited: 'com_ui_nearai_reply_edited',
  unclassified: 'com_ui_nearai_reply_unclassified',
  unsigned: 'com_ui_nearai_reply_unsigned',
  failed: 'com_ui_nearai_proof_failed',
} as const;

const titles = {
  verified: 'com_ui_nearai_reply_verified_title',
  gateway: 'com_ui_nearai_reply_gateway_title',
  edited: 'com_ui_nearai_reply_edited',
  unclassified: 'com_ui_nearai_reply_unclassified',
  unsigned: 'com_ui_nearai_reply_unsigned',
  failed: 'com_ui_nearai_proof_failed',
} as const;

const bodies = {
  verified: 'com_ui_nearai_reply_verified_body',
  gateway: 'com_ui_nearai_reply_gateway_body',
  edited: 'com_ui_nearai_reply_edited_body',
  unclassified: 'com_ui_nearai_reply_unclassified_body',
  unsigned: 'com_ui_nearai_reply_unsigned_body',
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
    state = replyState(receipts, isReplyEdited(message));
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
        title={state === 'signing' ? localize('com_ui_nearai_reply_signing_body') : undefined}
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
          <ReplyDetails state={state} receipts={receipts} attestation={attestation} />
        </Ariakit.Popover>
      )}
    </span>
  );
}

/** The check rows for each reply state, in the order the popover lists them. */
function useReplyRows(state: ReplyState, receipts: TNearAIReceipt[]): CheckRow[] {
  const localize = useLocalize();
  const model = receipts[0]?.model ?? '';
  const algo = receipts.find((receipt) => receipt.signingAlgo)?.signingAlgo;
  const notRun = localize('com_ui_nearai_check_not_run');

  const signature = (caption: string): CheckRow => ({
    id: 'signature',
    state: 'done',
    title: localize('com_ui_nearai_check_signature'),
    caption,
  });
  const asSigned = localize('com_ui_nearai_check_signature_as_signed_caption');
  const modelSigner: CheckRow = {
    id: 'signer',
    state: 'done',
    title: localize('com_ui_nearai_check_signer'),
    caption: localize('com_ui_nearai_check_signer_caption'),
  };
  const gatewaySigner: CheckRow = {
    id: 'signer',
    state: 'done',
    title: localize('com_ui_nearai_check_signer_gateway'),
    caption: localize('com_ui_nearai_check_signer_gateway_caption'),
  };
  const unclassifiedSigner: CheckRow = {
    id: 'signer',
    state: 'warn',
    title: localize('com_ui_nearai_reply_unclassified'),
    caption: localize('com_ui_nearai_check_signer_unclassified_caption'),
  };
  const signers = { model: modelSigner, gateway: gatewaySigner, unclassified: unclassifiedSigner };
  /** With no signature to read, these name no signer, since nothing shows whose key it was. */
  const notRunRows: CheckRow[] = [
    {
      id: 'signer',
      state: 'skip',
      title: localize('com_ui_nearai_check_signer_plain'),
      caption: notRun,
    },
    {
      id: 'model',
      state: 'skip',
      title: localize('com_ui_nearai_check_model_plain'),
      caption: notRun,
    },
  ];
  const signedFor = (rowState: CheckRow['state'], caption: string): CheckRow => ({
    id: 'model',
    state: rowState,
    title: localize('com_ui_nearai_check_model', { 0: model }),
    caption,
  });

  switch (state) {
    case 'verified':
      return [
        signature(
          algo
            ? localize('com_ui_nearai_check_signature_caption', { 0: algo.toUpperCase() })
            : localize('com_ui_nearai_check_signature_caption_plain'),
        ),
        modelSigner,
        signedFor('done', localize('com_ui_nearai_check_model_caption')),
      ];
    case 'gateway':
      return [
        signature(localize('com_ui_nearai_check_signature_gateway_caption')),
        gatewaySigner,
        {
          id: 'model',
          state: 'skip',
          title: localize('com_ui_nearai_check_model_unsigned'),
          caption: localize('com_ui_nearai_check_model_unsigned_caption'),
        },
      ];
    case 'edited':
      return [
        signature(asSigned),
        {
          id: 'text',
          state: 'warn',
          title: localize('com_ui_nearai_check_text_edited'),
          caption: localize('com_ui_nearai_check_text_edited_caption'),
        },
        signers[signerKind(receipts)],
      ];
    case 'unclassified':
      return [
        signature(
          algo
            ? localize('com_ui_nearai_check_signature_receipt_caption', { 0: algo.toUpperCase() })
            : localize('com_ui_nearai_check_signature_receipt_caption_plain'),
        ),
        unclassifiedSigner,
        signedFor('skip', notRun),
      ];
    case 'unsigned':
      return [
        {
          id: 'signature',
          state: 'skip',
          title: localize('com_ui_nearai_check_signature_missing'),
          caption: localize('com_ui_nearai_check_signature_missing_caption', {
            0: receipts.find((receipt) => receipt.errorCode)?.errorCode ?? '',
          }),
        },
        ...notRunRows,
      ];
    case 'failed':
      return [
        {
          id: 'signature',
          state: 'fail',
          title: localize('com_ui_nearai_check_signature_failed'),
          caption: localize('com_ui_nearai_check_signature_failed_caption'),
        },
        ...notRunRows,
      ];
  }
}

function ReplyDetails({
  state,
  receipts,
  attestation,
}: {
  state: ReplyState;
  receipts: TNearAIReceipt[];
  /** The deployment answer for this reply's endpoint and model. */
  attestation?: TNearAIAttestationResponse;
}) {
  const localize = useLocalize();
  const rows = useReplyRows(state, receipts);
  const verifyUrl = attestation?.enabled === true ? attestation.verifyUrl : undefined;
  const when = formatCheckedAt(receipts[0]?.verifiedAt);
  const link = verifyUrl
    ? receipts.map((receipt) => receiptVerifyLink(verifyUrl, receipt)).find(Boolean)
    : undefined;

  return (
    <>
      <div className="flex items-start gap-3">
        <SealMark tone={seals[state].tone} glyph={seals[state].glyph} size={48} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1">
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

type ProofFieldData = { label: string; value: string };

function ProofField({ label, value }: ProofFieldData) {
  const localize = useLocalize();
  return (
    <div className="flex items-center gap-2.5 text-xs">
      <dt className="text-text-secondary w-24 shrink-0">{label}</dt>
      <dd className="min-w-0 flex-1 truncate font-mono" title={value}>
        {value}
      </dd>
      <Copy value={value} label={localize('com_ui_nearai_copy_field', { 0: label })} />
    </div>
  );
}

/** The raw receipt fields, folded away until asked for. Copy all works either way. */
function ProofData({ receipts }: { receipts: TNearAIReceipt[] }) {
  const localize = useLocalize();
  const panelId = useId();
  const [open, setOpen] = useState(false);

  const receiptFields = receipts.map((receipt): ProofFieldData[] => {
    const hashes = signedHashes(receipt.signedText);
    const signedBy =
      receipt.signatureKind === 'provider_tee'
        ? receipt.model
        : receipt.signatureKind && localize('com_ui_nearai_signature_scope_gateway');
    const fields: { label: string; value?: string }[] = [
      { label: localize('com_ui_nearai_signature_completion'), value: receipt.completionId },
      { label: localize('com_ui_nearai_signature_scope'), value: signedBy },
      { label: localize('com_ui_nearai_signature_algorithm'), value: receipt.signingAlgo },
      { label: localize('com_ui_nearai_signature_signer'), value: receipt.signingAddress },
      { label: localize('com_ui_nearai_signature_request_hash'), value: hashes?.request },
      { label: localize('com_ui_nearai_signature_response_hash'), value: hashes?.response },
      /** A signed text in a form we can't split still gets shown whole. */
      {
        label: localize('com_ui_nearai_signature_signed'),
        value: hashes ? undefined : receipt.signedText,
      },
      { label: localize('com_ui_nearai_signature_value'), value: receipt.signature },
      { label: localize('com_ui_nearai_shield_error'), value: receipt.errorCode },
    ];
    return fields.filter((field): field is ProofFieldData => !!field.value);
  });
  const allFields = receiptFields
    .map((fields) => fields.map(({ label, value }) => `${label}: ${value}`).join('\n'))
    .join('\n\n');

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="focus-visible:ring-focus-control inline-flex items-center gap-1.5 rounded text-sm font-semibold focus-visible:ring-2 focus-visible:outline-hidden"
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
        <span className="flex-1" />
        <Copy
          value={allFields}
          label={localize('com_ui_nearai_copy_all_label')}
          text={localize('com_ui_nearai_copy_all')}
        />
      </div>
      {open && (
        <div id={panelId} className="flex flex-col gap-3">
          {receiptFields.map((fields, index) => (
            <dl key={receipts[index].completionId} className="flex flex-col gap-1.5">
              {fields.map((field) => (
                <ProofField key={field.label} {...field} />
              ))}
            </dl>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(Signature);
