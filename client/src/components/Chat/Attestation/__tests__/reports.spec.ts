import type {
  TNearAIAttestationResponse,
  TNearAIVerificationReport,
} from 'librechat-data-provider';
import { combineReplyReports, reportStaleTime, hardwareVerifiedAt } from '../reports';
import { report, modelReport, gatewayReport } from 'test/fixtures/nearai';

const success: TNearAIAttestationResponse = {
  enabled: true,
  model: modelReport.model!,
  status: 'verified',
  checkedAt: modelReport.verifiedAt,
  reports: [modelReport, gatewayReport],
};

it.each<[string, TNearAIAttestationResponse | undefined, 'success' | 'loading' | 'error', number]>([
  ['verified and partial reports', success, 'success', 300_000],
  ['Gateway only', { ...success, status: 'partial', reports: [gatewayReport] }, 'success', 300_000],
  ['failed result', { ...success, status: 'failed' }, 'success', 0],
  ['failed report', { ...success, reports: [{ ...modelReport, status: 'failed' }] }, 'success', 0],
  [
    'unverifiable report',
    { ...success, reports: [{ ...modelReport, status: 'unverifiable' }] },
    'success',
    0,
  ],
  ['empty reports', { ...success, reports: [] }, 'success', 0],
  ['missing reports', { ...success, reports: undefined }, 'success', 0],
  ['disabled endpoint', { enabled: false }, 'success', 0],
  ['no data', undefined, 'loading', 0],
  ['failed refresh retaining old data', success, 'error', 0],
])('reuses %s only when the last request succeeded', (_name, data, status, expected) => {
  expect(reportStaleTime(data, status)).toBe(expected);
});

it('uses the earliest hardware verification time, excluding the saved signature', () => {
  expect(hardwareVerifiedAt([gatewayReport, modelReport, report])).toBe(modelReport.verifiedAt);
  expect(hardwareVerifiedAt([report])).toBeUndefined();
  expect(hardwareVerifiedAt()).toBeUndefined();
});

it('combines matching model evidence and Gateway evidence while preserving the saved signature and time', () => {
  const current = {
    ...modelReport,
    verifiedAt: gatewayReport.verifiedAt,
    attestation: { ...modelReport.attestation!, advisoryIds: ['new-advisory'] },
    evidence: { intelQuote: 'quote', nonce: 'nonce', eventLog: '[]', nvidiaPayload: '{}' },
  };
  const result = combineReplyReports(report, [gatewayReport, current]);
  expect(result).toHaveLength(2);
  expect(result[0]).toEqual({
    ...report,
    attestation: current.attestation,
    evidence: current.evidence,
  });
  expect(result[0].signature).toBe(report.signature);
  expect(result[0].verifiedAt).toBe(report.verifiedAt);
  expect(result[0].status).toBe(report.status);
  expect(result[1]).toBe(gatewayReport);
  expect(report.attestation?.advisoryIds).toEqual([]);
});

it.each(['signer', 'osImageHash', 'composeHash'])(
  'keeps independent evidence separate when %s differs',
  (field) => {
    const changed: TNearAIVerificationReport = {
      ...modelReport,
      attestation: {
        ...modelReport.attestation!,
        signer: {
          ...modelReport.attestation!.signer,
          signingAddress:
            field === 'signer' ? 'e'.repeat(64) : modelReport.attestation!.signer.signingAddress,
        },
        deployment: {
          runtimeMeasurements: {
            osImageHash:
              field === 'osImageHash'
                ? 'e'.repeat(64)
                : modelReport.attestation!.deployment.runtimeMeasurements.osImageHash,
            composeHash:
              field === 'composeHash'
                ? 'e'.repeat(64)
                : modelReport.attestation!.deployment.runtimeMeasurements.composeHash,
          },
        },
      },
    };
    expect(combineReplyReports(report, [changed, gatewayReport])).toEqual([
      report,
      changed,
      gatewayReport,
    ]);
  },
);

it('excludes evidence for another model so the iframe can accept the report array', () => {
  const otherModel = { ...modelReport, model: 'other/model' };
  const otherGateway = { ...gatewayReport, model: 'other/model' };
  expect(combineReplyReports(report, [otherModel, otherGateway, gatewayReport])).toEqual([
    report,
    gatewayReport,
  ]);
});

it('does not merge failed hardware into a successful reply verdict', () => {
  const failed = {
    ...modelReport,
    status: 'failed' as const,
    attestation: undefined,
    error: { code: 'test', message: 'Current verification failed' },
  };
  expect(combineReplyReports(report, [failed])).toEqual([report, failed]);
});

it('matches equivalent signing addresses with different hex prefixes and casing', () => {
  const address = 'ab'.repeat(32);
  const saved = {
    ...report,
    attestation: {
      ...report.attestation!,
      signer: { ...report.attestation!.signer, signingAddress: address },
    },
    signature: {
      ...report.signature!,
      signer: { ...report.signature!.signer, signingAddress: address },
    },
  };
  const mixed = {
    ...modelReport,
    attestation: {
      ...modelReport.attestation!,
      signer: {
        ...modelReport.attestation!.signer,
        signingAddress: `0x${address.toUpperCase()}`,
      },
    },
  };
  expect(combineReplyReports(saved, [mixed])).toHaveLength(1);
});
