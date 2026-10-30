import { ApiError } from '@nearai/inference-sdk/node';
import { verifyModelReports } from './models';

it('does not request model evidence for a Gateway-only response', async () => {
  const client = {
    fetchModelMetadata: jest
      .fn()
      .mockResolvedValue({ providerType: 'vllm', attestationSupported: true }),
    fetchGatewayAttestation: jest.fn().mockRejectedValue(new Error('unavailable')),
    fetchModelAttestations: jest.fn(),
  };
  const reports = await verifyModelReports(client, 'test/model', 'gateway');
  expect(reports).toHaveLength(1);
  expect(reports[0]).toMatchObject({ kind: 'model', scope: 'gateway', status: 'unverifiable' });
  expect(client.fetchModelAttestations).not.toHaveBeenCalled();
});

it('returns safe scoped reports for upstream failures without exposing provider messages', async () => {
  const client = {
    fetchModelMetadata: jest
      .fn()
      .mockResolvedValue({ providerType: 'vllm', attestationSupported: true }),
    fetchGatewayAttestation: jest.fn().mockRejectedValue(new Error('SECRET provider payload')),
    fetchModelAttestations: jest
      .fn()
      .mockRejectedValue(
        new ApiError({ code: 'api.nonce_mismatch', details: { resource: 'model_attestation' } }),
      ),
  };
  const reports = await verifyModelReports(client, 'test/model');
  expect(reports).toEqual([
    expect.objectContaining({ kind: 'model', scope: 'gateway', status: 'unverifiable' }),
    expect.objectContaining({ kind: 'model', scope: 'model', status: 'failed' }),
  ]);
  expect(reports.every((report) => report.model === 'test/model')).toBe(true);
  expect(JSON.stringify(reports)).not.toContain('SECRET');
  expect(client.fetchModelAttestations).toHaveBeenCalledWith({
    model: 'test/model',
    signingAlgo: 'ed25519',
  });
});

it('cannot report success when the provider returns no model attestations', async () => {
  const reports = await verifyModelReports(
    {
      fetchModelMetadata: jest
        .fn()
        .mockResolvedValue({ providerType: 'vllm', attestationSupported: true }),
      fetchGatewayAttestation: jest.fn().mockRejectedValue(new Error('unavailable')),
      fetchModelAttestations: jest.fn().mockResolvedValue({
        clientBinding: { nonce: '0'.repeat(64) },
        attestations: [],
      }),
    },
    'test/model',
  );
  expect(reports[1]).toMatchObject({
    kind: 'model',
    scope: 'model',
    status: 'unverifiable',
    error: { code: 'policy.model_attestation_required' },
  });
});

it('uses the real SDK to reject invalid evidence rather than trusting a provider verdict', async () => {
  const reports = await verifyModelReports(
    {
      fetchModelMetadata: jest
        .fn()
        .mockResolvedValue({ providerType: 'vllm', attestationSupported: true }),
      fetchGatewayAttestation: jest.fn().mockRejectedValue(new Error('unavailable')),
      fetchModelAttestations: jest.fn().mockResolvedValue({
        clientBinding: { nonce: '0'.repeat(64) },
        attestations: [
          {
            intelQuote: 'invalid',
            eventLog: '[]',
            signingAlgo: 'ed25519',
            signingAddress: '1'.repeat(64),
          },
        ],
      }),
    },
    'test/model',
  );
  expect(reports[1].status).not.toBe('verified');
  expect(reports[1].attestation).toBeUndefined();
});

it.each(['external', 'chutes'])(
  'does not request NEAR model evidence for %s, even if it advertises attestation',
  async (providerType) => {
    const client = {
      fetchModelMetadata: jest.fn().mockResolvedValue({ providerType, attestationSupported: true }),
      fetchGatewayAttestation: jest.fn().mockRejectedValue(new Error('unavailable')),
      fetchModelAttestations: jest.fn(),
    };
    const reports = await verifyModelReports(client, 'test/model');
    expect(reports).toHaveLength(1);
    expect(reports[0].scope).toBe('gateway');
    expect(client.fetchModelAttestations).not.toHaveBeenCalled();
  },
);

it('bounds stalled hardware checks and preserves the error scope', async () => {
  const controller = new AbortController();
  const pending = verifyModelReports(
    {
      fetchModelMetadata: jest
        .fn()
        .mockResolvedValue({ providerType: 'vllm', attestationSupported: true }),
      fetchGatewayAttestation: jest.fn().mockReturnValue(new Promise(() => {})),
      fetchModelAttestations: jest.fn().mockReturnValue(new Promise(() => {})),
    },
    'test/model',
    undefined,
    controller.signal,
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort(new DOMException('Deadline exceeded', 'TimeoutError'));
  expect(await pending).toEqual([
    expect.objectContaining({
      scope: 'gateway',
      status: 'unverifiable',
      error: expect.objectContaining({ code: 'nearai_verification_timeout' }),
    }),
    expect.objectContaining({
      scope: 'model',
      status: 'unverifiable',
      error: expect.objectContaining({ code: 'nearai_verification_timeout' }),
    }),
  ]);
});
