import { memo, useCallback, useRef, useState } from 'react';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { OGDialog, TooltipAnchor, useTheme } from '@librechat/client';
import { Loader2, ShieldAlert, ShieldCheck, ShieldHalf } from 'lucide-react';
import { useNearAIAttestationQuery } from '~/data-provider/Misc/queries';
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
  const status = useNearAIAttestationQuery(params);
  const details = useQuery({
    queryKey: [...queryKey, 'reports'],
    queryFn: ({ signal }) =>
      dataService.getNearAIAttestation({ ...params, reports: true, refresh: true }, signal),
    enabled: open && status.data?.enabled === true,
    retry: false,
    refetchOnWindowFocus: false,
    onSuccess: () => queryClient.invalidateQueries({ queryKey, exact: true }),
  });
  if (status.data?.enabled !== true) {
    return null;
  }
  const attestation = status.data;
  const report = details.data?.enabled === true ? details.data : undefined;
  let state: ShieldState = 'checking';
  if (!details.isFetching && !status.isFetching) {
    const accepted =
      attestation.status !== 'failed' &&
      (!report || report.status === attestation.status) &&
      !status.isError &&
      !details.isError;
    state = 'failed';
    if (accepted) state = attestation.status === 'partial' ? 'gateway' : 'verified';
  }
  const label = localize(`com_ui_nearai_shield_${state}`);
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
            data-testid="header-nearai-shield"
            onClick={() => setOpen(true)}
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
            pending={details.isLoading || details.isFetching}
            isError={details.isError || status.isError || details.data?.enabled === false}
            onVerify={() => {
              void details.refetch();
            }}
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
