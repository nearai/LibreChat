import { useMemo, useState } from 'react';
import { SelectDropDown } from '@librechat/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TNearAIReceipt, TNearAIVerificationReport } from 'librechat-data-provider';
import { combineReplyReports, hardwareVerifiedAt, replyReport, replyEnvironment } from './reports';
import { reportQueryOptions } from './queries';
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
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(receipts[0].completionId);
  const receipt = receipts.find((item) => item.completionId === selected) ?? receipts[0];
  const reply = replyReport(receipt);
  const model = reply?.model ?? receipt.model;
  const params = replyEnvironment(endpoint, receipt);
  const enabled = !!params;
  const environment = useQuery({
    ...reportQueryOptions(queryClient, params ?? { endpoint: endpoint ?? '', model }),
    enabled,
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
    // A failed report request is not evidence about an additional hardware replica.
    const unavailable: TNearAIVerificationReport = {
      schemaVersion: 1,
      kind: 'model',
      model,
      scope: 'unknown',
      status: 'unverifiable',
      verifiedAt: new Date(environment.errorUpdatedAt || environment.dataUpdatedAt).toISOString(),
      error: { code: 'nearai_environment_unavailable', message: failureMessage },
    };
    return combineReplyReports(reply, [unavailable]);
  }, [
    reply,
    enabled,
    environment.data,
    environment.isError,
    environment.errorUpdatedAt,
    environment.dataUpdatedAt,
    model,
    failureMessage,
  ]);
  return (
    <Viewer
      model={model}
      reports={reports}
      hardwareVerifiedAt={
        !environment.isError && environment.data?.enabled
          ? hardwareVerifiedAt(environment.data.reports)
          : undefined
      }
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
