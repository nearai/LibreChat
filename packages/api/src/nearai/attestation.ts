import { logger } from '@librechat/data-schemas';
import { extractEnvVariable } from 'librechat-data-provider';
import { InferenceClient, isApiError, isVerificationError } from '@nearai/inference-sdk/node';
import type { AppConfig } from '@librechat/data-schemas';
import type { NearAIReceipt } from './receipts';
import { getNearAIReceiptCollector, observeCompletionBody } from './receipts';
import { getCustomEndpointConfig } from '~/app/config';
import { isUserProvided } from '~/utils';

/** NEAR AI Cloud Gateway hosts whose attestation the SDK can verify. */
const NEAR_AI_HOSTS = new Set(['cloud-api.near.ai']);

/** Matches the SDK's default deployment-verification cache lifetime. */
const ATTESTATION_TTL_MS = 60 * 60 * 1000;

export type NearAIAttestationState = 'verified' | 'failed';

export interface NearAIAttestationStatus {
  model: string;
  status: NearAIAttestationState;
  /** When the deployment evidence was last checked (not when the cache was read). */
  checkedAt: string;
  errorCode?: string;
  message?: string;
}

/** Matches the `Fetch` shape the OpenAI client configuration accepts. */
export type NearAIFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface NearAICredentials {
  apiKey: string;
  baseURL: string;
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

/** One SDK client per credential pair, so Chat and status checks share the verification cache. */
const clients = new Map<string, InferenceClient>();
const statuses = new Map<string, NearAIAttestationStatus>();

const clientKey = ({ apiKey, baseURL }: NearAICredentials) => `${baseURL}\n${apiKey}`;

function getClient(credentials: NearAICredentials, fresh = false): InferenceClient {
  const key = clientKey(credentials);
  let client = clients.get(key);
  if (!client || fresh) {
    client = new InferenceClient({
      apiKey: credentials.apiKey,
      baseUrl: credentials.baseURL,
      attestationCacheTimeToLiveMs: ATTESTATION_TTL_MS,
      /** Encrypts Chat to the verified model key. Without it, streamed replies are signed
       *  by the Gateway rather than the model TEE. */
      e2ee: true,
    });
    clients.set(key, client);
  }
  return client;
}

function errorCode(error: unknown): string {
  if (isVerificationError(error) || isApiError(error)) {
    return error.failure.code;
  }
  return 'unknown';
}

/**
 * Verifies the Gateway and model deployment for `model`, reusing the SDK cache unless
 * `refresh` is set. Never throws; failures are returned as a `failed` status.
 */
export async function verifyNearAIModel(
  credentials: NearAICredentials,
  model: string,
  refresh = false,
): Promise<NearAIAttestationStatus> {
  const statusKey = `${clientKey(credentials)}\n${model}`;
  const previous = statuses.get(statusKey);
  try {
    await getClient(credentials, refresh).verify(model);
    const now = Date.now();
    const isFreshCheck =
      refresh ||
      previous?.status !== 'verified' ||
      now - Date.parse(previous.checkedAt) >= ATTESTATION_TTL_MS;
    const status: NearAIAttestationStatus = {
      model,
      status: 'verified',
      checkedAt: isFreshCheck ? new Date(now).toISOString() : previous.checkedAt,
    };
    statuses.set(statusKey, status);
    return status;
  } catch (error) {
    const code = errorCode(error);
    logger.warn(`[nearai] Attestation failed for ${model}: ${code}`, error);
    const status: NearAIAttestationStatus = {
      model,
      status: 'failed',
      checkedAt: new Date().toISOString(),
      errorCode: code,
      message: error instanceof Error ? error.message : String(error),
    };
    statuses.set(statusKey, status);
    return status;
  }
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
    if (model) {
      const status = await verifyNearAIModel(credentials, model);
      if (status.status !== 'verified') {
        return attestationFailedResponse(model, status.errorCode ?? 'unknown');
      }
    }
    /** The client that sent the request holds its captured bytes, so it must verify the reply. */
    const client = getClient(credentials);
    const response = await client.fetch(input, init);
    const collector = getNearAIReceiptCollector();
    if (!collector || !model || !response.ok) {
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
    return {
      completionId,
      model,
      status: 'verified',
      verifiedAt: new Date().toISOString(),
      signatureKind: result.signatureKind,
      signingAlgo: result.signature.signer.signingAlgo,
      signingAddress: result.signature.signer.signingAddress,
      signedText: result.signature.signedText,
      signature: result.signature.signature,
    };
  } catch (error) {
    const code = errorCode(error);
    logger.warn(`[nearai] Signature verification failed for ${completionId}: ${code}`, error);
    return {
      completionId,
      model,
      status: 'failed',
      verifiedAt: new Date().toISOString(),
      errorCode: code,
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
  return { apiKey, baseURL };
}
