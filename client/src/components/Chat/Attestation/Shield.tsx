import { useState, useCallback, memo, useEffect } from 'react';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { Loader2, ShieldAlert, ShieldCheck, ShieldHalf } from 'lucide-react';
import { Button, OGDialog, OGDialogTrigger, TooltipAnchor } from '@librechat/client';
import { useQuery, useMutation, useIsMutating, useQueryClient } from '@tanstack/react-query';
import { useNearAIAttestationQuery } from '~/data-provider/Misc/queries';
import { useGetStartupConfig } from '~/data-provider/Endpoints/queries';
import { prefetchReport, reportQueryOptions } from './queries';
import { hardwareVerifiedAt } from './reports';
import { useChatContext } from '~/Providers';
import { useLocalize } from '~/hooks';
import Viewer from './Viewer';
import { cn } from '~/utils';

const states = {
  checking: [
    Loader2,
    'com_ui_nearai_shield_checking',
    'text-text-secondary animate-spin motion-reduce:animate-none',
  ],
  verified: [ShieldCheck, 'com_ui_nearai_shield_verified', 'text-status-success'],
  gateway: [ShieldHalf, 'com_ui_nearai_shield_gateway', 'text-status-warning'],
  failed: [ShieldAlert, 'com_ui_nearai_shield_failed', 'text-status-error'],
} as const;

export function ModelShield(params: { endpoint: string; model: string }) {
  return <ModelVerification key={`${params.endpoint}:${params.model}`} {...params} />;
}

function ModelVerification(params: { endpoint: string; model: string }) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const queryKey = [QueryKeys.nearaiAttestation, params.endpoint, params.model];
  const startupConfig = useGetStartupConfig();
  const expected = startupConfig.data?.nearaiEndpoints?.includes(params.endpoint) === true;
  const status = useNearAIAttestationQuery(params);
  const attestation = status.data?.enabled === true ? status.data : undefined;
  const options = reportQueryOptions(queryClient, params);
  const reportsKey = options.queryKey;
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
    enabled: open && !!attestation,
  });
  const supported = expected || !!attestation;
  useEffect(() => {
    if (!params.model || !supported) return;
    void prefetchReport(queryClient, { endpoint: params.endpoint, model: params.model });
  }, [queryClient, params.endpoint, params.model, supported]);
  // A configured NEAR AI endpoint shows its first check instead of appearing only once it ends.
  if (!attestation && !(expected && status.isInitialLoading)) {
    return null;
  }
  const report = details.data?.enabled === true ? details.data : undefined;
  let state: keyof typeof states = 'checking';
  if (attestation && !reverifying) {
    // Unverifiable evidence is shown in the report; only rejected evidence turns the shield red.
    const failed =
      attestation.status === 'failed' ||
      status.isError ||
      report?.reports?.some((entry) => entry.status === 'failed');
    state = attestation.status === 'partial' ? 'gateway' : 'verified';
    if (failed) state = 'failed';
  }
  const [Icon, labelKey, color] = states[state];
  const label = localize(labelKey);
  return (
    <OGDialog open={open} onOpenChange={(next) => setOpen(next && !!attestation)}>
      <OGDialogTrigger asChild>
        <TooltipAnchor
          description={label}
          render={
            <Button
              variant="header-action"
              size="icon"
              aria-label={label}
              aria-disabled={!attestation}
              data-testid="header-nearai-shield"
              className="size-9 shrink-0"
            >
              <Icon aria-hidden="true" className={cn('icon-md', color)} />
            </Button>
          }
        />
      </OGDialogTrigger>
      {open && (
        <Viewer
          model={params.model}
          reports={report?.reports}
          hardwareVerifiedAt={hardwareVerifiedAt(report?.reports)}
          pending={details.isFetching || reverifying}
          isError={details.isError || status.isError || details.data?.enabled === false}
          onVerify={() => reverify.mutate()}
          onClose={close}
        />
      )}
    </OGDialog>
  );
}

function Shield() {
  const { conversation } = useChatContext();
  return <ModelShield endpoint={conversation?.endpoint ?? ''} model={conversation?.model ?? ''} />;
}

export default memo(Shield);
