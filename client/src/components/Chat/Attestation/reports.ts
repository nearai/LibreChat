import type { TNearAIVerificationReport } from 'librechat-data-provider';

/** Match the example: enrich matching hardware without changing the saved signature or verdict. */
export function combineReplyReports(
  reply: TNearAIVerificationReport,
  environment: TNearAIVerificationReport[],
): TNearAIVerificationReport[] {
  environment = environment.filter(
    (entry) => entry.kind === 'model' && (reply.model == null || entry.model === reply.model),
  );
  const attestation = reply.attestation;
  const measurements = attestation?.deployment.runtimeMeasurements;
  const identity = (value: string) => value.replace(/^0x/i, '').toLowerCase();
  const matched =
    attestation && measurements?.osImageHash && measurements.composeHash
      ? environment.find((entry) => {
          const hardware = entry.attestation;
          return (
            entry.scope === reply.scope &&
            (entry.status === 'verified' || entry.status === 'partial') &&
            hardware &&
            hardware.signer.signingAlgo === attestation.signer.signingAlgo &&
            identity(hardware.signer.signingAddress) ===
              identity(attestation.signer.signingAddress) &&
            hardware.deployment.runtimeMeasurements.osImageHash === measurements.osImageHash &&
            hardware.deployment.runtimeMeasurements.composeHash === measurements.composeHash
          );
        })
      : undefined;
  return [
    matched
      ? {
          ...reply,
          attestation: matched.attestation,
          ...(matched.evidence ? { evidence: matched.evidence } : {}),
        }
      : reply,
    ...environment.filter((entry) => entry !== matched),
  ];
}
