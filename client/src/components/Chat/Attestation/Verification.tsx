import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SelectDropDown } from '@librechat/client';
import { dataService, QueryKeys } from 'librechat-data-provider';
import type { TNearAIReceipt, TNearAIVerificationReport } from 'librechat-data-provider';
import { combineReplyReports } from './reports';
import { useLocalize } from '~/hooks';
import Viewer from './Viewer';

export default function Verification({
  endpoint,
  receipts,
  darkMode,
  onClose,
}: {
  endpoint?: string | null;
  receipts: TNearAIReceipt[];
  darkMode: boolean;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const [selected, setSelected] = useState(receipts[0].completionId);
  const receipt = receipts.find((item) => item.completionId === selected) ?? receipts[0];
  const reply =
    receipt.report?.kind === 'reply' && receipt.report.completionId === receipt.completionId
      ? receipt.report
      : undefined;
  const model = reply?.model ?? receipt.model;
  const scope = reply?.scope === 'gateway' ? 'gateway' : undefined;
  const enabled = !!endpoint && !!reply?.signature && !!reply.attestation;
  const environment = useQuery({
    queryKey: [QueryKeys.nearaiAttestation, endpoint, model, 'reply-environment', scope],
    queryFn: ({ signal }) =>
      dataService.getNearAIAttestation(
        { endpoint: endpoint ?? '', model, reports: true, scope },
        signal,
      ),
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const failureMessage = localize('com_ui_nearai_environment_unavailable');
  const reports = useMemo(() => {
    if (!reply) return;
    if (!enabled) return [reply];
    if (
      !environment.isError &&
      environment.data?.enabled === true &&
      environment.data.reports?.length
    ) {
      return combineReplyReports(reply, environment.data.reports);
    }
    if (!environment.isError && !environment.data) return [reply];
    const scopes: ('gateway' | 'model')[] =
      scope === 'gateway' ? ['gateway'] : ['gateway', 'model'];
    const failures = scopes.map(
      (scope): TNearAIVerificationReport => ({
        schemaVersion: 1,
        kind: 'model',
        model,
        scope,
        status: 'unverifiable',
        verifiedAt: new Date(environment.errorUpdatedAt || environment.dataUpdatedAt).toISOString(),
        error: { code: 'nearai_environment_unavailable', message: failureMessage },
      }),
    );
    return combineReplyReports(reply, failures);
  }, [
    reply,
    enabled,
    environment.data,
    environment.isError,
    environment.errorUpdatedAt,
    environment.dataUpdatedAt,
    scope,
    model,
    failureMessage,
  ]);
  return (
    <Viewer
      model={model}
      reports={reports}
      receipt={receipt}
      darkMode={darkMode}
      onClose={onClose}
      pending={enabled && (environment.isLoading || environment.isFetching)}
      onVerify={
        enabled && environment.data?.enabled !== false
          ? () => {
              void environment.refetch();
            }
          : undefined
      }
      verifyLabel={localize('com_ui_nearai_hardware_verify_again')}
      description={enabled ? localize('com_ui_nearai_verification_response') : undefined}
    >
      {receipts.length > 1 && (
        <SelectDropDown
          title={localize('com_ui_nearai_signature_completion')}
          value={receipt.completionId}
          setValue={setSelected}
          availableValues={receipts.map((item) => item.completionId)}
        />
      )}
    </Viewer>
  );
}
