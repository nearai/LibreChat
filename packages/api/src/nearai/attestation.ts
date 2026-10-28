import { logger } from '@librechat/data-schemas';
import { AttestationClient, InferenceClient, VerificationError } from '@nearai/inference-sdk/node';
import {
  extractEnvVariable,
  DEFAULT_NEAR_AI_VERIFICATION_TIMEOUT_MS,
} from 'librechat-data-provider';
import type { TNearAIAttestationParams, TNearAIVerificationReport } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { NearAIReceipt } from './receipts';
import { createReplyReport, createFailureReport, getVerificationErrorCode } from './report';
import { getNearAIReceiptCollector, observeCompletionBody } from './receipts';
import { getCustomEndpointConfig } from '~/app/config';
import { getSafeErrorMetadata } from '~/utils/errors';
import { detachOnAbort } from '~/utils/promises';
import { verifyModelReports } from './models';
import { isUserProvided } from '~/utils';

/** NEAR AI Cloud Gateway hosts whose attestation the SDK can verify. */
const NEAR_AI_HOSTS = new Set(['cloud-api.near.ai', 'cloud-stg-api.near.ai']);

/** Matches the SDK's default deployment-verification cache lifetime. */
const ATTESTATION_TTL_MS = 60 * 60 * 1000;

export type NearAIAttestationState = 'verified' | 'partial' | 'failed';

export interface NearAIAttestationStatus {
  model: string;
  status: NearAIAttestationState;
  scope?: 'model' | 'gateway';
  /** When the deployment evidence was last checked (not when the cache was read). */
  checkedAt: string;
  errorCode?: string;
}

/** Matches the `Fetch` shape the OpenAI client configuration accepts. */
export type NearAIFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface NearAICredentials {
  apiKey: string;
  baseURL: string;
  verificationTimeoutMs?: number;
}

/** Stable error code the client can recognize when attestation blocks a Chat request. */
export const NEAR_AI_ATTESTATION_FAILED = 'nearai_attestation_failed';

/**
 * A local 403 in the OpenAI error format. Returning it, rather than throwing, keeps the
 * OpenAI client from treating the block as a connection error that LangChain would retry.
 */
function attestationFailedResponse(model: string, code: string): Response {
  const message = `NEAR AI attestation failed for ${model} (${code}). The message was not sent.`;
  return new Response(
    JSON.stringify({ error: { message, type: NEAR_AI_ATTESTATION_FAILED, code } }),
    { status: 403, headers: { 'content-type': 'application/json' } },
  );
}

export function isNearAIBaseURL(baseURL?: string | null): boolean {
  if (!baseURL) {
    return false;
  }
  try {
    return NEAR_AI_HOSTS.has(new URL(baseURL).hostname);
  } catch {
    return false;
  }
}

type Session = { client: InferenceClient; scope: 'model' | 'gateway'; checkedAt?: string };
type CachedSession = { createdAt: number; pending: Promise<Session>; invalidated?: boolean };
// Metadata selects E2EE/signing mode, so sessions must be scoped to the requested model.
const clients = new Map<string, CachedSession>();
const clientKey = ({ apiKey, baseURL }: NearAICredentials, model: string) =>
  `${baseURL}\n${apiKey}\n${model}`;

function invalidateSession(key: string): void {
  const entry = clients.get(key);
  if (entry) entry.invalidated = true;
  clients.delete(key);
}

function getSession(credentials: NearAICredentials, model: string, fresh = false): CachedSession {
  const key = clientKey(credentials, model);
  const previous = clients.get(key);
  if (previous && !fresh && Date.now() - previous.createdAt < ATTESTATION_TTL_MS) return previous;
  invalidateSession(key);
  const pending = new AttestationClient({
    apiKey: credentials.apiKey,
    baseUrl: credentials.baseURL,
  })
    .fetchModelMetadata(model)
    .then((metadata): Session => {
      const provider = metadata.providerType.trim().toLowerCase();
      if (!['vllm', 'external', 'chutes'].includes(provider)) {
        throw new VerificationError({ code: 'policy.model_attestation_required' });
      }
      const privateModel = provider === 'vllm';
      return {
        scope: privateModel ? 'model' : 'gateway',
        client: new InferenceClient({
          apiKey: credentials.apiKey,
          baseUrl: credentials.baseURL,
          attestationCacheTimeToLiveMs: ATTESTATION_TTL_MS,
          e2ee: privateModel,
          signingAlgo: privateModel ? 'ed25519' : 'ecdsa',
        }),
      };
    });
  const entry = { createdAt: Date.now(), pending };
  clients.set(key, entry);
  void pending.catch(() => {
    if (clients.get(key) === entry) clients.delete(key);
  });
  return entry;
}

/** Display reports leave Chat's SDK session intact unless explicitly refreshed. */
export async function verifyNearAIModelReports(
  credentials: NearAICredentials,
  model: string,
  options: Pick<TNearAIAttestationParams, 'scope' | 'refresh'> = {},
): Promise<TNearAIVerificationReport[]> {
  try {
    return await verifyModelReports(
      new AttestationClient({ apiKey: credentials.apiKey, baseUrl: credentials.baseURL }),
      model,
      options.scope,
      AbortSignal.timeout(
        credentials.verificationTimeoutMs ?? DEFAULT_NEAR_AI_VERIFICATION_TIMEOUT_MS,
      ),
    );
  } finally {
    if (options.refresh) {
      invalidateSession(clientKey(credentials, model));
    }
  }
}

/**
 * Verifies the Gateway and model deployment for `model`, reusing the SDK cache unless
 * `refresh` is set. Never throws; failures are returned as a `failed` status.
 */
export async function verifyNearAIModel(
  credentials: NearAICredentials,
  model: string,
  refresh = false,
  signal?: AbortSignal,
): Promise<NearAIAttestationStatus> {
  signal ??= AbortSignal.timeout(
    credentials.verificationTimeoutMs ?? DEFAULT_NEAR_AI_VERIFICATION_TIMEOUT_MS,
  );
  let entry: CachedSession | undefined;
  let status: NearAIAttestationStatus;
  try {
    signal.throwIfAborted();
    entry = getSession(credentials, model, refresh);
    const session = await detachOnAbort(entry.pending, signal);
    await detachOnAbort(session.client.verify(model), signal);
    session.checkedAt ??= new Date().toISOString();
    status = {
      model,
      status: session.scope === 'model' ? 'verified' : 'partial',
      scope: session.scope,
      checkedAt: session.checkedAt,
    };
  } catch (error) {
    if (signal.aborted && clients.get(clientKey(credentials, model)) === entry) {
      invalidateSession(clientKey(credentials, model));
    }
    const code = getVerificationErrorCode(error);
    logger.warn(`[nearai] Attestation failed for ${model}: ${code}`, getSafeErrorMetadata(error));
    status = {
      model,
      status: 'failed',
      checkedAt: new Date().toISOString(),
      errorCode: code,
    };
  }
  // Refresh can invalidate the entry before metadata resolves; its own rejection is not a refresh.
  if (!signal.aborted && entry?.invalidated) {
    return verifyNearAIModel(credentials, model, false, signal);
  }
  return status;
}

function readModel(body: RequestInit['body']): string | undefined {
  if (typeof body !== 'string') {
    return undefined;
  }
  try {
    const parsed = JSON.parse(body) as { model?: unknown };
    return typeof parsed.model === 'string' ? parsed.model : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A fetch for the OpenAI client that sends Chat requests through the NEAR AI SDK.
 * The deployment is verified first; on failure the request is never sent upstream.
 */
export function createNearAIFetch(credentials: NearAICredentials): NearAIFetch {
  return async (input, init) => {
    const model = readModel(init?.body);
    if (!model) return attestationFailedResponse('', 'input.invalid');
    const signal = AbortSignal.any([
      AbortSignal.timeout(
        credentials.verificationTimeoutMs ?? DEFAULT_NEAR_AI_VERIFICATION_TIMEOUT_MS,
      ),
      ...(init?.signal ? [init.signal] : []),
    ]);
    const status = await verifyNearAIModel(credentials, model, false, signal);
    if (status.status === 'failed') {
      return attestationFailedResponse(model, status.errorCode ?? 'unknown');
    }
    /** The client that sent the request holds its captured bytes, so it must verify the reply. */
    const { client } = await detachOnAbort(getSession(credentials, model).pending, signal);
    const response = await client.fetch(input, init);
    const collector = getNearAIReceiptCollector();
    if (!collector || !response.ok) {
      return response;
    }
    return observeCompletionBody(response, (completionId) =>
      collector.add(verifyNearAICompletion(client, model, completionId)),
    );
  };
}

/** Checks the completion's signature against the exact request and response bytes. */
async function verifyNearAICompletion(
  client: InferenceClient,
  model: string,
  completionId: string,
): Promise<NearAIReceipt> {
  try {
    const result = await client.verifyResponse(completionId);
    const verifiedAt = new Date().toISOString();
    const report = createReplyReport(result, verifiedAt);
    if (!report.ok) {
      logger.warn('[nearai] Verification report unavailable', { code: report.error.code });
    }
    return {
      completionId,
      model,
      status: 'verified',
      verifiedAt,
      signatureKind: result.signatureKind,
      signingAlgo: result.signature.signer.signingAlgo,
      signingAddress: result.signature.signer.signingAddress,
      signedText: result.signature.signedText,
      signature: result.signature.signature,
      ...(report.ok ? { report: report.value } : {}),
    };
  } catch (error) {
    const code = getVerificationErrorCode(error);
    logger.warn(
      `[nearai] Signature verification failed for ${completionId}: ${code}`,
      getSafeErrorMetadata(error),
    );
    const verifiedAt = new Date().toISOString();
    return {
      completionId,
      model,
      status: 'failed',
      verifiedAt,
      errorCode: code,
      report: createFailureReport(error, completionId, model, verifiedAt),
    };
  }
}

/**
 * Resolves credentials for a NEAR AI custom endpoint from app config.
 * Returns undefined for other endpoints and for user-provided keys or URLs.
 */
export function getNearAICredentials(
  appConfig: AppConfig | undefined,
  endpoint: string,
): NearAICredentials | undefined {
  let endpointConfig;
  try {
    endpointConfig = getCustomEndpointConfig({ endpoint, appConfig });
  } catch {
    return undefined;
  }
  const apiKey = extractEnvVariable(endpointConfig?.apiKey ?? '');
  const baseURL = extractEnvVariable(endpointConfig?.baseURL ?? '');
  if (!apiKey || !isNearAIBaseURL(baseURL) || isUserProvided(apiKey)) {
    return undefined;
  }
  return {
    apiKey,
    baseURL,
    ...(appConfig?.config.nearai && {
      verificationTimeoutMs: appConfig.config.nearai.verificationTimeoutMs,
    }),
  };
}
