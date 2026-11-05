import { logger } from '@librechat/data-schemas';
import { extractEnvVariable } from 'librechat-data-provider';
import {
  InferenceClient,
  isApiError,
  isVerificationError,
  createTdxQuoteVerifier,
  createGpuEvidenceVerifier,
} from '@nearai/inference-sdk/node';
import type { InferenceClientOptions, ModelAttestationVerifiers } from '@nearai/inference-sdk/node';
import type { TNearAICheckOutcome, TNearAIDeploymentCheck } from 'librechat-data-provider';
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

export type NearAIDeploymentChecks = Record<TNearAIDeploymentCheck, TNearAICheckOutcome>;

export interface NearAIAttestationStatus {
  model: string;
  status: NearAIAttestationState;
  /** When the deployment evidence was last checked (not when the cache was read). */
  checkedAt: string;
  errorCode?: string;
  message?: string;
  checks?: NearAIDeploymentChecks;
  /** Intel's status for the model's platform, when all of its quotes read the same. */
  tcbStatus?: string;
}

/** Matches the `Fetch` shape the OpenAI client configuration accepts. */
export type NearAIFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** SDK verifier settings. Production leaves them unset and uses the SDK defaults. */
export type NearAIVerificationOptions = Pick<
  InferenceClientOptions,
  'gatewayVerification' | 'modelVerification'
>;

export interface NearAICredentials {
  apiKey: string;
  baseURL: string;
  /** Read once, when the client for this key and URL is created. */
  verification?: NearAIVerificationOptions;
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

/** What a verified session established that `verify(model)` does not return. */
interface SessionFacts {
  gpu: 'passed' | 'not_provided';
  tcbStatus?: string;
}

/** Counts for the verification in flight: every model report passes one TDX quote check. */
interface VerificationRun {
  quotes: number;
  gpuAccepted: number;
  tcbStatuses: Set<string>;
}

/**
 * The SDK client, extended through its protected seams to keep Intel's status for the
 * model's platform and whether NVIDIA accepted GPU evidence. Nothing is verified twice: the
 * wrappers delegate to the caller's verifiers or the SDK's defaults, and only note what
 * they accept.
 */
class NearAIInferenceClient extends InferenceClient {
  private readonly facts = new Map<string, SessionFacts>();
  private readonly runs = new Map<string, VerificationRun>();

  /** Facts of the session `verify(model)` last resolved from. */
  sessionFacts(model: string): SessionFacts | undefined {
    return this.facts.get(model);
  }

  protected override async createVerificationState(model: string) {
    const run: VerificationRun = { quotes: 0, gpuAccepted: 0, tcbStatuses: new Set() };
    this.runs.set(model, run);
    try {
      const session = await super.createVerificationState(model);
      this.facts.set(model, {
        /** The SDK accepts a report without GPU evidence, so a pass needs it from every one. */
        gpu: run.gpuAccepted > 0 && run.gpuAccepted === run.quotes ? 'passed' : 'not_provided',
        tcbStatus: run.tcbStatuses.size === 1 ? [...run.tcbStatuses][0] : undefined,
      });
      return session;
    } catch (error) {
      this.facts.delete(model);
      throw error;
    } finally {
      if (this.runs.get(model) === run) {
        this.runs.delete(model);
      }
    }
  }

  protected override getModelVerifiers(model: string): ModelAttestationVerifiers {
    const verifiers = super.getModelVerifiers(model);
    const verifyQuote = verifiers?.tdxQuote ?? createTdxQuoteVerifier();
    const verifyGpu = verifiers?.gpuEvidence ?? createGpuEvidenceVerifier();
    const run = this.runs.get(model);
    return {
      ...verifiers,
      tdxQuote: async (quote) => {
        const result = await verifyQuote(quote);
        if (run) {
          run.quotes += 1;
          run.tcbStatuses.add(result.tcbStatus);
        }
        return result;
      },
      gpuEvidence: async (payload) => {
        await verifyGpu(payload);
        if (run) {
          run.gpuAccepted += 1;
        }
      },
    };
  }
}

/** One SDK client per credential pair, so Chat and status checks share the verification cache. */
const clients = new Map<string, NearAIInferenceClient>();
const statuses = new Map<string, NearAIAttestationStatus>();

const clientKey = ({ apiKey, baseURL }: NearAICredentials) => `${baseURL}\n${apiKey}`;

function getClient(credentials: NearAICredentials, fresh = false): NearAIInferenceClient {
  const key = clientKey(credentials);
  let client = clients.get(key);
  if (!client || fresh) {
    client = new NearAIInferenceClient({
      ...credentials.verification,
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
 * The check a verification failure belongs to, when the failure says. The Gateway and the
 * model run the same TDX quote, measurement and report-data checks concurrently, and those
 * failures do not say whose evidence failed, so they name no check; neither do `api.*`
 * failures, where the evidence never arrived to be checked.
 */
export function failedNearAICheck(error: unknown): TNearAIDeploymentCheck | undefined {
  if (!isVerificationError(error)) {
    return undefined;
  }
  const { failure } = error;
  switch (failure.code) {
    case 'binding.spki_fingerprint_required':
    case 'binding.spki_fingerprint_mismatch':
      return 'gateway';
    case 'binding.report_data_mismatch':
      return failure.details.source === 'signerTlsBinding' ? 'gateway' : undefined;
    case 'binding.nonce_mismatch':
      return failure.details.source === 'nvidiaPayload' ? 'gpu' : undefined;
    case 'policy.gpu_evidence_required':
      return 'gpu';
    case 'policy.model_attestation_required':
    case 'binding.model_public_key_mismatch':
      return 'key';
  }
  const area = failure.code.split('.')[0];
  if (area === 'ohttp') {
    return 'gateway';
  }
  if (area === 'gpu') {
    return 'gpu';
  }
  if (area === 'e2ee') {
    return 'key';
  }
  return undefined;
}

function failedChecks(error: unknown): NearAIDeploymentChecks {
  const checks: NearAIDeploymentChecks = {
    gateway: 'not_checked',
    cpu: 'not_checked',
    gpu: 'not_checked',
    key: 'not_checked',
  };
  const failed = failedNearAICheck(error);
  if (failed) {
    checks[failed] = 'failed';
  }
  return checks;
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
  const client = getClient(credentials, refresh);
  try {
    await client.verify(model);
    const now = Date.now();
    const isFreshCheck =
      refresh ||
      previous?.status !== 'verified' ||
      now - Date.parse(previous.checkedAt) >= ATTESTATION_TTL_MS;
    const facts = client.sessionFacts(model);
    const status: NearAIAttestationStatus = {
      model,
      status: 'verified',
      checkedAt: isFreshCheck ? new Date(now).toISOString() : previous.checkedAt,
    };
    if (facts) {
      status.checks = { gateway: 'passed', cpu: 'passed', gpu: facts.gpu, key: 'passed' };
      status.tcbStatus = facts.tcbStatus;
    }
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
      checks: failedChecks(error),
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
