import { memo, useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import * as Ariakit from '@ariakit/react';
import { ArrowUpRight, RefreshCw, X } from 'lucide-react';
import { Button, buttonVariants } from '@librechat/client';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TNearAIAttestationResponse } from 'librechat-data-provider';
import type { DeploymentCheck, DeploymentReport, DeploymentState } from './proof';
import type { GlyphState, ProofTone } from './Seal';
import type { CheckRow } from './CheckList';
import {
  DEPLOYMENT_CHECKS,
  isCheckFailure,
  deploymentState,
  formatCheckedAt,
  deploymentChecks,
  failedDeploymentCheck,
} from './proof';
import { useNearAIAttestationQuery } from '~/data-provider/Misc/queries';
import { proofPulseAtom, useHeaderSealKey } from './state';
import { ProofGlyph, SealBadge, SealMark } from './Seal';
import { useChatContext } from '~/Providers';
import { modelVerifyLink } from './links';
import { sealCode } from './geometry';
import { useLocalize } from '~/hooks';
import CheckList from './CheckList';
import { cn } from '~/utils';
import Copy from './Copy';

/** How long a fresh "Verified" stays spelled out before the pill folds to its seal. */
const COLLAPSE_AFTER_MS = 3600;
const PULSE_MS = 2400;

const pillTones: Record<DeploymentState, string> = {
  checking: 'bg-status-neutral-subtle text-text-secondary',
  verified: 'bg-status-proof-subtle text-status-proof',
  failed: 'bg-status-error-subtle text-status-error ring-1 ring-inset ring-status-error',
  unavailable: 'bg-status-neutral-subtle text-text-secondary',
};

const glyphStates: Record<DeploymentState, GlyphState> = {
  checking: 'checking',
  verified: 'verified',
  failed: 'failed',
  unavailable: 'none',
};

const sealTones: Record<DeploymentState, ProofTone> = {
  checking: 'neutral',
  verified: 'positive',
  failed: 'critical',
  unavailable: 'neutral',
};

const sealCenters = {
  checking: 'spinner',
  verified: 'badge',
  failed: 'cross',
  unavailable: 'dash',
} as const;

const titleColors: Record<DeploymentState, string> = {
  checking: 'text-text-primary',
  verified: 'text-status-proof',
  failed: 'text-status-error',
  unavailable: 'text-text-primary',
};

const words = {
  checking: 'com_ui_nearai_proof_checking',
  verified: 'com_ui_nearai_proof_verified',
  failed: 'com_ui_nearai_proof_failed',
  unavailable: 'com_ui_nearai_proof_unavailable',
} as const;

const titles = {
  checking: 'com_ui_nearai_deploy_checking_title',
  verified: 'com_ui_nearai_deploy_verified_title',
  failed: 'com_ui_nearai_proof_failed',
  unavailable: 'com_ui_nearai_deploy_unavailable_title',
} as const;

const checkTitles = {
  gateway: 'com_ui_nearai_check_gateway',
  cpu: 'com_ui_nearai_check_cpu',
  gpu: 'com_ui_nearai_check_gpu',
  key: 'com_ui_nearai_check_key',
} as const;

const checkCaptions = {
  gateway: 'com_ui_nearai_check_gateway_caption',
  cpu: 'com_ui_nearai_check_cpu_caption',
  gpu: 'com_ui_nearai_check_gpu_caption',
  key: 'com_ui_nearai_check_key_caption',
} as const;

/**
 * Header proof button for NEAR AI endpoints. The server verifies the Gateway and the
 * model's hardware with the inference SDK; the pill shows that result, and its popover
 * lists the checks and the seal drawn from the key that signs this chat's replies.
 */
function Shield() {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const disclosureRef = useRef<HTMLButtonElement>(null);
  const popover = Ariakit.usePopoverStore({ placement: 'bottom-end' });
  const open = Ariakit.useStoreState(popover, 'open');
  const { conversation } = useChatContext();
  const params = { endpoint: conversation?.endpoint ?? '', model: conversation?.model ?? '' };
  const queryKey = [QueryKeys.nearaiAttestation, params.endpoint, params.model];

  const { data, isError, isFetching } = useNearAIAttestationQuery(params);
  const reverify = useMutation({
    mutationFn: () => dataService.getNearAIAttestation({ ...params, refresh: true }),
    onSuccess: (result: TNearAIAttestationResponse) => queryClient.setQueryData(queryKey, result),
  });
  const sealKey = useHeaderSealKey(conversation?.conversationId, params.model, data);

  const attestation = data?.enabled === true ? data : undefined;
  const state = deploymentState({
    data,
    isError,
    isChecking: reverify.isLoading || (!attestation && isFetching),
  });

  /** The shine and spring play only when a check in flight comes back verified. */
  const [fresh, setFresh] = useState(false);
  const previousState = useRef(state);
  useEffect(() => {
    if (state === 'checking') {
      setFresh(false);
    } else if (previousState.current === 'checking' && state === 'verified') {
      setFresh(true);
    }
    previousState.current = state;
  }, [state]);

  const pulse = useAtomValue(proofPulseAtom);
  const seenPulse = useRef(pulse);
  const [pulsing, setPulsing] = useState(false);
  useEffect(() => {
    if (pulse === seenPulse.current) {
      return;
    }
    seenPulse.current = pulse;
    setPulsing(true);
    const timer = setTimeout(() => setPulsing(false), PULSE_MS);
    return () => clearTimeout(timer);
  }, [pulse]);

  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    if (state !== 'verified') {
      return;
    }
    const timer = setTimeout(() => setSettled(true), COLLAPSE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [state, pulse]);

  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  if (data?.enabled === false) {
    return null;
  }
  if (!data && !isFetching && !isError) {
    return null;
  }

  const collapsed = state === 'verified' && settled && !hovered && !focused && !open;
  const code = sealKey ? sealCode(sealKey) : undefined;
  const word = localize(words[state]);
  const failed = state === 'failed' ? failedDeploymentCheck(attestation) : undefined;
  const ariaLabel =
    state === 'verified' && code
      ? localize('com_ui_nearai_proof_aria_seal', { 0: word, 1: code })
      : localize('com_ui_nearai_proof_aria', { 0: word });

  return (
    <>
      <Ariakit.PopoverDisclosure
        ref={disclosureRef}
        store={popover}
        aria-label={ariaLabel}
        data-testid="header-nearai-shield"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={cn(
          'relative inline-flex h-9 shrink-0 items-center overflow-hidden rounded-full text-sm font-semibold',
          'ease-proof-spring transition-all duration-300 motion-reduce:transition-none',
          'focus-visible:ring-focus-control focus-visible:ring-2 focus-visible:outline-hidden',
          collapsed ? 'gap-0 px-2' : 'gap-1.5 pr-3 pl-2',
          pillTones[state],
          pulsing && 'animate-proof-pulse motion-reduce:animate-none',
        )}
      >
        <ProofGlyph
          state={glyphStates[state]}
          failedSegment={failed ? DEPLOYMENT_CHECKS.indexOf(failed) : undefined}
          className="size-5"
        />
        <span
          aria-hidden="true"
          className={cn(
            'ease-proof-spring overflow-hidden whitespace-nowrap transition-all duration-300 motion-reduce:transition-none',
            collapsed ? 'max-w-0 opacity-0' : 'max-w-36 opacity-100',
          )}
        >
          {word}
        </span>
        {fresh && (
          <span
            aria-hidden="true"
            className="animate-proof-shine via-text-on-status/60 dark:via-text-on-status/25 pointer-events-none absolute inset-y-0 left-[-40%] w-[30%] -skew-x-12 bg-gradient-to-r from-transparent to-transparent motion-reduce:hidden"
          />
        )}
      </Ariakit.PopoverDisclosure>
      <span role="status" className="sr-only">
        {state === 'checking' ? '' : ariaLabel}
      </span>
      <Ariakit.Popover
        store={popover}
        gutter={8}
        portal
        unmountOnHide
        fitViewport
        finalFocus={disclosureRef}
        className="popover-animate border-border-light bg-surface-secondary text-text-primary rounded-theme-popover z-[200] flex max-h-[var(--popover-available-height)] w-[23.25rem] max-w-[calc(100vw-2rem)] flex-col gap-3.5 overflow-y-auto overscroll-contain border p-4 shadow-lg focus:outline-none"
      >
        <div className="flex items-start gap-3">
          <SealMark
            key={state}
            sealKey={state === 'verified' ? sealKey : undefined}
            tone={sealTones[state]}
            center={sealCenters[state]}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1.5">
            <Ariakit.PopoverHeading
              className={cn('text-base leading-5.25 font-bold', titleColors[state])}
            >
              {localize(titles[state])}
            </Ariakit.PopoverHeading>
            <p className="text-text-secondary text-xs leading-4">
              <CheckedLabel state={state} checkedAt={attestation?.checkedAt} />
            </p>
          </div>
          <Ariakit.PopoverDismiss
            aria-label={localize('com_ui_close')}
            className="text-text-secondary hover:bg-surface-hover focus-visible:ring-focus-control flex size-7 shrink-0 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-hidden"
          >
            <X className="size-3.5" aria-hidden="true" />
          </Ariakit.PopoverDismiss>
        </div>

        <p className="text-sm leading-5">
          <DeploymentBody
            state={state}
            model={params.model}
            errorCode={attestation?.errorCode}
            blamedCheck={failed != null}
          />
        </p>

        {state !== 'unavailable' && <DeploymentChecks state={state} report={attestation} />}

        {state === 'verified' && (
          <div className="flex min-h-5 items-center gap-2">
            {code && sealKey ? (
              <>
                <SealBadge className="size-4" />
                <span className="font-mono text-xs font-semibold">
                  {localize('com_ui_nearai_seal_code', { 0: code })}
                </span>
                <Copy value={code} label={localize('com_ui_nearai_copy_seal')} />
                <span className="text-text-secondary ml-auto text-xs">
                  {localize('com_ui_nearai_seal_same')}
                </span>
              </>
            ) : (
              <span className="text-text-secondary text-xs">
                {localize('com_ui_nearai_seal_pending')}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            shape="round"
            onClick={() => reverify.mutate()}
            disabled={state === 'checking'}
          >
            <RefreshCw
              aria-hidden="true"
              className={cn(
                'size-3.5',
                reverify.isLoading && 'animate-spin motion-reduce:animate-none',
              )}
            />
            {localize('com_ui_nearai_check_again')}
          </Button>
          <span className="flex-1" />
          {attestation?.verifyUrl && (
            <a
              href={modelVerifyLink(attestation.verifyUrl, params.model)}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: 'submit', size: 'sm', shape: 'round' })}
            >
              {state === 'failed'
                ? localize('com_ui_nearai_see_failure')
                : localize('com_ui_nearai_open_report')}
              <ArrowUpRight aria-hidden="true" className="size-3.5" />
              <span className="sr-only">{localize('com_ui_nearai_opens_nearai')}</span>
            </a>
          )}
        </div>

        <p className="text-text-secondary border-border-light border-t pt-2.5 text-xs leading-4">
          {state === 'failed' || state === 'unavailable'
            ? localize('com_ui_nearai_deploy_failed_footer')
            : localize('com_ui_nearai_deploy_footer')}
        </p>
      </Ariakit.Popover>
    </>
  );
}

function CheckedLabel({ state, checkedAt }: { state: DeploymentState; checkedAt?: string }) {
  const localize = useLocalize();
  const when = state === 'checking' ? undefined : formatCheckedAt(checkedAt);
  if (!when) {
    return <>{localize('com_ui_nearai_deploy_checking_sub')}</>;
  }
  if (when.justNow) {
    return <>{localize('com_ui_nearai_checked_just_now')}</>;
  }
  return <>{localize('com_ui_nearai_checked_at', { 0: when.label })}</>;
}

function DeploymentBody({
  state,
  model,
  errorCode,
  blamedCheck,
}: {
  state: DeploymentState;
  model: string;
  errorCode?: string;
  /** A check row shows the failure code, so the body need not repeat it. */
  blamedCheck: boolean;
}) {
  const localize = useLocalize();
  if (state === 'checking') {
    return <>{localize('com_ui_nearai_deploy_checking_body', { 0: model })}</>;
  }
  if (state === 'verified') {
    return <>{localize('com_ui_nearai_deploy_verified_body', { 0: model })}</>;
  }
  if (state === 'failed' && blamedCheck) {
    return <>{localize('com_ui_nearai_deploy_failed_body', { 0: model })}</>;
  }
  if (state === 'failed' && isCheckFailure(errorCode)) {
    return <>{localize('com_ui_nearai_deploy_failed_code_body', { 0: model, 1: errorCode })}</>;
  }
  if (state === 'failed') {
    return <>{localize('com_ui_nearai_deploy_failed_unknown_body', { 0: model })}</>;
  }
  return <>{localize('com_ui_nearai_deploy_unavailable_body')}</>;
}

function DeploymentChecks({
  state,
  report,
}: {
  state: DeploymentState;
  report?: DeploymentReport;
}) {
  const localize = useLocalize();
  const states = deploymentChecks(state, report);
  const caption = (check: DeploymentCheck) => {
    if (states[check] === 'fail') {
      return localize('com_ui_nearai_check_fail_caption', { 0: report?.errorCode ?? '' });
    }
    if (states[check] === 'warn') {
      return localize('com_ui_nearai_check_not_provided');
    }
    if (states[check] === 'skip') {
      return localize('com_ui_nearai_check_unconfirmed');
    }
    return localize(checkCaptions[check]);
  };
  const rows: CheckRow[] = DEPLOYMENT_CHECKS.map((check) => ({
    id: check,
    state: states[check],
    title: localize(checkTitles[check]),
    caption: caption(check),
  }));
  return <CheckList rows={rows} />;
}

export default memo(Shield);
