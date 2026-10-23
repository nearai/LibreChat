import { memo, useRef } from 'react';
import * as Ariakit from '@ariakit/react';
import { TooltipAnchor } from '@librechat/client';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2, RefreshCw, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import type { TNearAIAttestationResponse } from 'librechat-data-provider';
import { useNearAIAttestationQuery } from '~/data-provider/Misc/queries';
import { useChatContext } from '~/Providers';
import { modelVerifyLink } from './links';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type ShieldState = 'checking' | 'verified' | 'failed';

const icons = { checking: Loader2, verified: ShieldCheck, failed: ShieldAlert } as const;

const iconColors: Record<ShieldState, string> = {
  checking: 'text-text-secondary animate-spin motion-reduce:animate-none',
  verified: 'text-status-success',
  failed: 'text-status-error',
};

/** Header shield for NEAR AI endpoints: the server verifies the deployment with the inference SDK. */
function Shield() {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const disclosureRef = useRef<HTMLButtonElement>(null);
  const popover = Ariakit.usePopoverStore({ placement: 'bottom-end' });
  const { conversation } = useChatContext();
  const params = { endpoint: conversation?.endpoint ?? '', model: conversation?.model ?? '' };
  const queryKey = [QueryKeys.nearaiAttestation, params.endpoint, params.model];

  const { data, isError, isFetching } = useNearAIAttestationQuery(params);
  const reverify = useMutation({
    mutationFn: () => dataService.getNearAIAttestation({ ...params, refresh: true }),
    onSuccess: (result: TNearAIAttestationResponse) => queryClient.setQueryData(queryKey, result),
  });

  if (data?.enabled === false) {
    return null;
  }
  if (!data && !isFetching && !isError) {
    return null;
  }

  const attestation = data?.enabled === true ? data : undefined;
  let state: ShieldState = 'checking';
  if (reverify.isLoading || (!attestation && isFetching)) {
    state = 'checking';
  } else if (attestation?.status === 'verified') {
    state = 'verified';
  } else if (attestation?.status === 'failed' || isError) {
    state = 'failed';
  }

  const label = localize(`com_ui_nearai_shield_${state}`);
  const Icon = icons[state];

  return (
    <>
      <TooltipAnchor
        description={label}
        render={
          <Ariakit.PopoverDisclosure
            ref={disclosureRef}
            store={popover}
            aria-label={label}
            data-testid="header-nearai-shield"
            className="border-border-chrome bg-presentation hover:bg-surface-tertiary aria-expanded:bg-surface-tertiary inline-flex size-9 flex-shrink-0 items-center justify-center rounded-xl border transition-all ease-in-out"
          >
            <Icon aria-hidden="true" className={cn('icon-md', iconColors[state])} />
          </Ariakit.PopoverDisclosure>
        }
      />
      <Ariakit.Popover
        store={popover}
        gutter={8}
        portal
        unmountOnHide
        finalFocus={disclosureRef}
        className="border-border-medium bg-surface-secondary text-text-primary rounded-theme-menu-panel z-[200] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 border p-3 shadow-lg focus:outline-none"
      >
        <div className="flex items-center gap-2">
          <Icon aria-hidden="true" className={cn('size-5 shrink-0', iconColors[state])} />
          <Ariakit.PopoverHeading className="flex-1 text-sm font-semibold">
            {label}
          </Ariakit.PopoverHeading>
          <TooltipAnchor
            description={localize('com_ui_nearai_shield_verify_again')}
            render={
              <button
                type="button"
                onClick={() => reverify.mutate()}
                disabled={state === 'checking'}
                aria-label={localize('com_ui_nearai_shield_verify_again')}
                className="hover:bg-surface-hover rounded-lg p-1 disabled:opacity-50"
              >
                <RefreshCw
                  aria-hidden="true"
                  className={cn(
                    'size-4',
                    reverify.isLoading && 'animate-spin motion-reduce:animate-none',
                  )}
                />
              </button>
            }
          />
          <Ariakit.PopoverDismiss
            aria-label={localize('com_ui_close')}
            className="hover:bg-surface-hover rounded-lg p-1"
          >
            <X className="size-4" aria-hidden="true" />
          </Ariakit.PopoverDismiss>
        </div>
        <p className="text-text-secondary text-sm">
          {localize(`com_ui_nearai_shield_${state}_desc`)}
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-text-secondary">{localize('com_ui_nearai_shield_model')}</dt>
          <dd className="font-mono break-all">{params.model}</dd>
          {attestation && (
            <>
              <dt className="text-text-secondary">{localize('com_ui_nearai_shield_checked_at')}</dt>
              <dd>{new Date(attestation.checkedAt).toLocaleString()}</dd>
            </>
          )}
          {attestation?.errorCode && (
            <>
              <dt className="text-text-secondary">{localize('com_ui_nearai_shield_error')}</dt>
              <dd className="text-status-error font-mono break-all">{attestation.errorCode}</dd>
            </>
          )}
        </dl>
        {isError && !attestation && (
          <p role="alert" className="text-status-error text-sm">
            {localize('com_ui_nearai_shield_unavailable')}
          </p>
        )}
        {attestation?.verifyUrl && (
          <a
            href={modelVerifyLink(attestation.verifyUrl, params.model)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={localize('com_ui_nearai_view_details')}
            className="border-border-medium text-text-primary hover:bg-surface-hover inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium"
          >
            {localize('com_ui_nearai_view_details_on')}
            <img src="/assets/nearai-logo.svg" alt="" className="h-3.5 w-auto dark:hidden" />
            <img
              src="/assets/nearai-logo-white.svg"
              alt=""
              className="hidden h-3.5 w-auto dark:block"
            />
            <ExternalLink className="text-text-secondary size-4" aria-hidden="true" />
          </a>
        )}
      </Ariakit.Popover>
    </>
  );
}

export default memo(Shield);
