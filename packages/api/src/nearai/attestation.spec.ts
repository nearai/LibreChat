import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { ApiError, VerificationError } from '@nearai/inference-sdk/node';
import type { TcbStatus, TdxQuoteVerificationResult } from '@nearai/inference-sdk/node';
import type { TNearAIDeploymentCheck } from 'librechat-data-provider';
import type { NearAICredentials } from './attestation';
import { failedNearAICheck, verifyNearAIModel } from './attestation';

const BASE_URL = 'http://nearai.test/v1';
const MODEL = 'nearai/test-model';
const NVIDIA_ISSUER = 'https://nras.attestation.nvidia.com';
const NRAS_URL = `${NVIDIA_ISSUER}/v3/attest/gpu`;
const JWKS_URL = `${NVIDIA_ISSUER}/.well-known/jwks.json`;
const RUNTIME_EVENT = 0x08000001;
const APP_COMPOSE = JSON.stringify({ docker_compose_file: 'services: {}' });

const digest = (algorithm: 'sha256' | 'sha384', ...parts: Buffer[]) =>
  createHash(algorithm).update(Buffer.concat(parts)).digest();

/** One dstack runtime event in IMR 3, and the RTMR3 its replay produces. */
const composeHash = digest('sha256', Buffer.from(APP_COMPOSE));
const eventType = Buffer.alloc(4);
eventType.writeUInt32LE(RUNTIME_EVENT);
const eventDigest = digest('sha384', eventType, Buffer.from(':compose-hash:'), composeHash);
const EVENT_LOG = [
  {
    imr: 3,
    event_type: RUNTIME_EVENT,
    digest: eventDigest.toString('hex'),
    event: 'compose-hash',
    event_payload: composeHash.toString('hex'),
  },
];
const RTMR3 = digest('sha384', Buffer.alloc(48), eventDigest);
const MRCONFIGID = Buffer.concat([Buffer.from([1]), composeHash, Buffer.alloc(15)]);

/**
 * Stands in for Intel DCAP, the one check that cannot run against mocked HTTP: it accepts
 * only quotes signed under Intel's root key. The fake quote carries what a real one binds.
 */
function tdxQuote(quote: string): TdxQuoteVerificationResult {
  const { reportData, tcbStatus } = JSON.parse(Buffer.from(quote, 'hex').toString()) as {
    reportData: string;
    tcbStatus: TcbStatus;
  };
  return {
    tcbStatus,
    advisoryIds: [],
    debugEnabled: false,
    reportData: Buffer.from(reportData, 'hex'),
    mrConfigId: MRCONFIGID,
    rtMr3: RTMR3,
  };
}

function ed25519Key(): string {
  const { publicKey } = generateKeyPairSync('ed25519');
  const { x } = publicKey.export({ format: 'jwk' });
  return Buffer.from(x ?? '', 'base64url').toString('hex');
}

/** Cloud API evidence bound to the request nonce and the signer, as a real TEE reports it. */
function evidence(nonce: string, signingAddress: string, tcbStatus: TcbStatus = 'UpToDate') {
  const reportData = Buffer.concat([Buffer.from(signingAddress, 'hex'), Buffer.from(nonce, 'hex')]);
  const quote = { reportData: reportData.toString('hex'), tcbStatus };
  return {
    request_nonce: nonce,
    signing_algo: 'ed25519',
    signing_address: signingAddress,
    intel_quote: Buffer.from(JSON.stringify(quote)).toString('hex'),
    event_log: EVENT_LOG,
    info: { tcb_info: { app_compose: APP_COMPOSE } },
    report_data: reportData.toString('hex'),
  };
}

type ModelReport = { key: string; gpu?: boolean; tcbStatus?: TcbStatus };

type Deployment = {
  models: ModelReport[];
  providerType?: string;
  gatewayStatus?: number;
  nvidiaAccepts?: boolean;
};

const GATEWAY_KEY = ed25519Key();
let nvidia: {
  privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
  jwk: Record<string, unknown>;
};

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('ES384');
  nvidia = { privateKey, jwk: { ...(await exportJWK(publicKey)), kid: 'nras-test', alg: 'ES384' } };
});

function nvidiaToken(nonce: string, accepted: boolean): Promise<string> {
  return new SignJWT({ 'x-nvidia-overall-att-result': accepted, eat_nonce: nonce })
    .setProtectedHeader({ alg: 'ES384', kid: 'nras-test' })
    .setIssuer(NVIDIA_ISSUER)
    .setIssuedAt()
    .setNotBefore('0s')
    .setExpirationTime('5m')
    .sign(nvidia.privateKey);
}

/** Answers the Cloud API and NVIDIA NRAS requests the SDK sends, as `deployment` describes. */
function mockHttp(deployment: Deployment) {
  return jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.href === JWKS_URL) {
      return Response.json({ keys: [nvidia.jwk] });
    }
    if (url.href === NRAS_URL) {
      const { nonce } = (await request.json()) as { nonce: string };
      const token = await nvidiaToken(nonce, deployment.nvidiaAccepts ?? true);
      return Response.json([['JWT', token]]);
    }
    if (url.pathname.endsWith(`/model/${encodeURIComponent(MODEL)}`)) {
      const providerType = deployment.providerType ?? 'vllm';
      return Response.json({ metadata: { providerType, attestationSupported: true } });
    }
    const nonce = url.searchParams.get('nonce') ?? '';
    if (url.pathname.endsWith('/attestation/report') && !url.searchParams.has('model')) {
      if (deployment.gatewayStatus) {
        return new Response('unavailable', { status: deployment.gatewayStatus });
      }
      return Response.json({ gateway_attestation: evidence(nonce, GATEWAY_KEY) });
    }
    if (url.pathname.endsWith('/attestation/report')) {
      const model_attestations = deployment.models.map(({ key, gpu, tcbStatus }) => ({
        ...evidence(nonce, key, tcbStatus),
        signing_public_key: key,
        ...(gpu && { nvidia_payload: JSON.stringify({ nonce, evidence_list: [] }) }),
      }));
      return Response.json({ model_attestations });
    }
    return new Response('not found', { status: 404 });
  });
}

let credentialCount = 0;

/** Fresh credentials per test, so each starts with its own SDK client and cache. */
function credentials(): NearAICredentials {
  credentialCount += 1;
  return {
    apiKey: `sk-test-${credentialCount}`,
    baseURL: BASE_URL,
    verification: {
      gatewayVerification: { includeSpkiFingerprint: false, verifiers: { tdxQuote } },
      modelVerification: { verifiers: { tdxQuote } },
    },
  };
}

const requestsTo = (fetchSpy: jest.SpyInstance, url: string) =>
  fetchSpy.mock.calls.filter(([input]) => new Request(input as RequestInfo).url === url).length;

describe('verifyNearAIModel', () => {
  it("reports every check passed and Intel's status when NVIDIA accepts GPU evidence", async () => {
    const fetchSpy = mockHttp({ models: [{ key: ed25519Key(), gpu: true }] });

    const status = await verifyNearAIModel(credentials(), MODEL);

    expect(status).toMatchObject({
      status: 'verified',
      checks: { gateway: 'passed', cpu: 'passed', gpu: 'passed', key: 'passed' },
      tcbStatus: 'UpToDate',
    });
    expect(requestsTo(fetchSpy, NRAS_URL)).toBe(1);
  });

  it('reports GPU evidence as not provided when the model TEE supplied none', async () => {
    const fetchSpy = mockHttp({ models: [{ key: ed25519Key() }] });

    const status = await verifyNearAIModel(credentials(), MODEL);

    expect(status.status).toBe('verified');
    expect(status.checks).toEqual({
      gateway: 'passed',
      cpu: 'passed',
      gpu: 'not_provided',
      key: 'passed',
    });
    expect(requestsTo(fetchSpy, NRAS_URL)).toBe(0);
  });

  it('does not report GPU as passed when only some of the model reports carry evidence', async () => {
    mockHttp({ models: [{ key: ed25519Key(), gpu: true }, { key: ed25519Key() }] });

    const status = await verifyNearAIModel(credentials(), MODEL);

    expect(status.status).toBe('verified');
    expect(status.checks?.gpu).toBe('not_provided');
  });

  it("reports the status Intel gave the model's quote, even when the policy accepts it", async () => {
    mockHttp({ models: [{ key: ed25519Key(), tcbStatus: 'OutOfDate' }] });

    const status = await verifyNearAIModel(credentials(), MODEL);

    expect(status.status).toBe('verified');
    expect(status.tcbStatus).toBe('OutOfDate');
  });

  it("reports no status when the model's quotes disagree", async () => {
    mockHttp({
      models: [
        { key: ed25519Key(), tcbStatus: 'UpToDate' },
        { key: ed25519Key(), tcbStatus: 'OutOfDate' },
      ],
    });

    const status = await verifyNearAIModel(credentials(), MODEL);

    expect(status.status).toBe('verified');
    expect(status.tcbStatus).toBeUndefined();
  });

  it('never reports a signing key, which the proof UI does not use', async () => {
    mockHttp({ models: [{ key: ed25519Key(), gpu: true }] });

    expect(await verifyNearAIModel(credentials(), MODEL)).not.toHaveProperty('signingKey');
  });

  it('keeps the session facts on cached verifications without fetching evidence again', async () => {
    const fetchSpy = mockHttp({ models: [{ key: ed25519Key(), gpu: true }] });
    const connection = credentials();

    const first = await verifyNearAIModel(connection, MODEL);
    const callsAfterFirst = fetchSpy.mock.calls.length;
    const second = await verifyNearAIModel(connection, MODEL);

    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);
    expect(second.checks).toEqual(first.checks);
    expect(second.tcbStatus).toBe('UpToDate');
  });

  it('marks the GPU check failed when NVIDIA rejects the evidence', async () => {
    mockHttp({ models: [{ key: ed25519Key(), gpu: true }], nvidiaAccepts: false });

    const status = await verifyNearAIModel(credentials(), MODEL);

    expect(status).toMatchObject({ status: 'failed', errorCode: 'gpu.attestation_rejected' });
    expect(status.checks).toEqual({
      gateway: 'not_checked',
      cpu: 'not_checked',
      gpu: 'failed',
      key: 'not_checked',
    });
    expect(status.tcbStatus).toBeUndefined();
  });

  it('marks the key check failed when the model has no attestation', async () => {
    mockHttp({ models: [], providerType: 'openai' });

    const status = await verifyNearAIModel(credentials(), MODEL);

    expect(status.errorCode).toBe('policy.model_attestation_required');
    expect(status.checks?.key).toBe('failed');
  });

  it('blames no check for a TDX failure that may be the Gateway or the model', async () => {
    mockHttp({ models: [{ key: ed25519Key(), tcbStatus: 'Revoked' }] });

    const status = await verifyNearAIModel(credentials(), MODEL);

    expect(status.errorCode).toBe('policy.tcb_status_not_allowed');
    expect(Object.values(status.checks ?? {})).toEqual(Array(4).fill('not_checked'));
  });

  it('blames no check when the evidence never arrived', async () => {
    mockHttp({ models: [{ key: ed25519Key() }], gatewayStatus: 503 });

    const status = await verifyNearAIModel(credentials(), MODEL);

    expect(status.errorCode).toBe('api.http_status');
    expect(Object.values(status.checks ?? {})).toEqual(Array(4).fill('not_checked'));
  });

  it('drops the status of a session that failed to re-verify', async () => {
    const connection = credentials();
    mockHttp({ models: [{ key: ed25519Key() }] });
    expect((await verifyNearAIModel(connection, MODEL)).tcbStatus).toBeDefined();

    mockHttp({ models: [{ key: ed25519Key() }], gatewayStatus: 503 });
    const status = await verifyNearAIModel(connection, MODEL, true);

    expect(status.status).toBe('failed');
    expect(status.tcbStatus).toBeUndefined();
  });
});

describe('failedNearAICheck', () => {
  const verification = (
    failure: ConstructorParameters<typeof VerificationError>[0],
  ): [string, Error] => [failure.code, new VerificationError(failure)];

  it.each<[string, Error, TNearAIDeploymentCheck]>([
    [...verification({ code: 'binding.spki_fingerprint_mismatch' }), 'gateway'],
    [
      ...verification({
        code: 'binding.report_data_mismatch',
        details: { source: 'signerTlsBinding' },
      }),
      'gateway',
    ],
    [
      ...verification({ code: 'binding.nonce_mismatch', details: { source: 'nvidiaPayload' } }),
      'gpu',
    ],
    [...verification({ code: 'policy.gpu_evidence_required' }), 'gpu'],
    [...verification({ code: 'binding.model_public_key_mismatch' }), 'key'],
    [...verification({ code: 'e2ee.model_public_key_required' }), 'key'],
  ])('attributes %s to its check', (_code, error, check) => {
    expect(failedNearAICheck(error)).toBe(check);
  });

  it.each<[string, Error]>([
    verification({ code: 'quote.collateral_unavailable', retryable: true }),
    verification({ code: 'measurement.rtmr3_mismatch', details: { reason: 'no_events' } }),
    verification({ code: 'binding.report_data_mismatch', details: { source: 'signerBinding' } }),
    [
      'api.nonce_mismatch',
      new ApiError({ code: 'api.nonce_mismatch', details: { resource: 'gateway_attestation' } }),
    ],
    ['a non-SDK error', new Error('socket hang up')],
  ])('names no check for %s', (_code, error) => {
    expect(failedNearAICheck(error)).toBeUndefined();
  });
});
