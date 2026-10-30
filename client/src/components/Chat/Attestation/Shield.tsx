import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { OGDialog, TooltipAnchor, useTheme } from '@librechat/client';
import { Loader2, ShieldAlert, ShieldCheck, ShieldHalf } from 'lucide-react';
import { useQuery, useMutation, useIsMutating, useQueryClient } from '@tanstack/react-query';
import { reportKey, prefetchReport, reportQueryOptions } from './queries';
import { useNearAIAttestationQuery } from '~/data-provider/Misc/queries';
import { useGetStartupConfig } from '~/data-provider/Endpoints/queries';
import { hardwareVerifiedAt } from './reports';
import { useChatContext } from '~/Providers';
import { useLocalize } from '~/hooks';
import Viewer from './Viewer';
import { cn } from '~/utils';

type ShieldState = 'checking' | 'verified' | 'gateway' | 'failed';
const icons = {
  checking: Loader2,
  verified: ShieldCheck,
  gateway: ShieldHalf,
  failed: ShieldAlert,
} as const;
const labels = {
  checking: 'com_ui_nearai_shield_checking',
  verified: 'com_ui_nearai_shield_verified',
  gateway: 'com_ui_nearai_shield_gateway',
  failed: 'com_ui_nearai_shield_failed',
} as const;
const iconColors: Record<ShieldState, string> = {
  checking: 'text-text-secondary animate-spin motion-reduce:animate-none',
  verified: 'text-status-success',
  gateway: 'text-status-warning',
  failed: 'text-status-error',
};

export function ModelShield(params: { endpoint: string; model: string }) {
  return <ModelVerification key={`${params.endpoint}:${params.model}`} {...params} />;
}

function ModelVerification(params: { endpoint: string; model: string }) {
  const localize = useLocalize();
  const { resolvedMode } = useTheme();
  const queryClient = useQueryClient();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => {
    setOpen(false);
    setTimeout(() => triggerRef.current?.focus(), 0);
  }, []);
  const queryKey = [QueryKeys.nearaiAttestation, params.endpoint, params.model];
  const startupConfig = useGetStartupConfig();
  const expected = startupConfig.data?.nearaiEndpoints?.includes(params.endpoint) === true;
  const status = useNearAIAttestationQuery(params);
  const options = reportQueryOptions(queryClient, params);
  const reportsKey = reportKey(params);
  const reverifying = useIsMutating({ mutationKey: reportsKey, exact: true }) > 0;
  const reverify = useMutation({
    mutationKey: reportsKey,
    mutationFn: () =>
      queryClient.fetchQuery({
        ...options,
        staleTime: 0,
        // Keep explicit verification running when switching models unmounts the shield.
        queryFn: () =>
          dataService.getNearAIAttestation({ ...params, reports: true, refresh: true }),
      }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: reportsKey });
      await queryClient.invalidateQueries({ queryKey: reportsKey, refetchType: 'none' });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey, exact: true });
    },
  });
  const details = useQuery({
    ...options,
    enabled: open && status.data?.enabled === true,
  });
  const supported = expected || status.data?.enabled === true;
  useEffect(() => {
    if (!params.model || !supported) return;
    void prefetchReport(queryClient, { endpoint: params.endpoint, model: params.model });
  }, [queryClient, params.endpoint, params.model, supported]);
  const attestation = status.data?.enabled === true ? status.data : undefined;
  // A configured NEAR AI endpoint shows its first check instead of appearing only once it ends.
  if (!attestation && !(expected && status.isInitialLoading)) {
    return null;
  }
  const report = details.data?.enabled === true ? details.data : undefined;
  let state: ShieldState = 'checking';
  if (attestation && !reverifying) {
    // Unverifiable evidence is shown in the report; only rejected evidence turns the shield red.
    const failed =
      attestation.status === 'failed' ||
      status.isError ||
      report?.reports?.some((entry) => entry.status === 'failed');
    state = attestation.status === 'partial' ? 'gateway' : 'verified';
    if (failed) state = 'failed';
  }
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
            aria-disabled={!attestation}
            data-testid="header-nearai-shield"
            onClick={() => attestation && setOpen(true)}
            className="border-border-chrome bg-presentation hover:bg-surface-tertiary aria-expanded:bg-surface-tertiary inline-flex size-9 flex-shrink-0 items-center justify-center rounded-xl border transition-all ease-in-out"
          >
            <Icon aria-hidden="true" className={cn('icon-md', iconColors[state])} />
          </button>
        }
      />
      <OGDialog open={open} onOpenChange={setOpen} triggerRef={triggerRef}>
        {open && (
          <Viewer
            model={params.model}
            reports={report?.reports}
            hardwareVerifiedAt={hardwareVerifiedAt(report?.reports)}
            pending={details.isFetching || reverifying}
            isError={details.isError || status.isError || details.data?.enabled === false}
            onVerify={() => reverify.mutate()}
            darkMode={resolvedMode === 'dark'}
            onClose={close}
          />
        )}
      </OGDialog>
    </>
  );
}

function Shield() {
  const { conversation } = useChatContext();
  return <ModelShield endpoint={conversation?.endpoint ?? ''} model={conversation?.model ?? ''} />;
}

export default memo(Shield);
