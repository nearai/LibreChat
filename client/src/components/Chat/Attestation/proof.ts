import type {
  TMessage,
  TNearAIReceipt,
  TNearAICheckOutcome,
  TNearAIAttestationResponse,
} from 'librechat-data-provider';

/** The checks behind a deployment proof, in the order the popover lists them. */
export const DEPLOYMENT_CHECKS = ['gateway', 'cpu', 'gpu', 'key'] as const;
export type DeploymentCheck = (typeof DEPLOYMENT_CHECKS)[number];

export type CheckState = 'done' | 'active' | 'fail' | 'warn' | 'skip';

export type DeploymentState = 'checking' | 'verified' | 'failed' | 'unavailable';

/**
 * What a reply's receipts establish, read from the captured signature and never from how
 * the call was made.
 * `gateway`: the signature is valid, but the Gateway signed it rather than the model.
 * `edited`: the shown text was changed in this app after signing.
 * `unclassified`: a signature exists, but its receipt doesn't say which kind of key made it.
 * `unsigned`: no signature was available to check.
 */
export type ReplyState = 'verified' | 'gateway' | 'edited' | 'unclassified' | 'unsigned' | 'failed';

/** Which kind of key signed a reply, as far as its receipts say. */
export type SignerKind = 'model' | 'gateway' | 'unclassified';

/** What the server said about the checks. Servers that predate `checks` send only the code. */
export type DeploymentReport = {
  errorCode?: string;
  checks?: Partial<Record<DeploymentCheck, TNearAICheckOutcome>>;
  tcbStatus?: string;
};

/** `not_provided` needs attention: the deployment passed without that evidence. */
const outcomeStates: Record<TNearAICheckOutcome, CheckState> = {
  passed: 'done',
  failed: 'fail',
  not_provided: 'warn',
  not_checked: 'skip',
};

const GATEWAY_CODES = new Set([
  'binding.spki_fingerprint_required',
  'binding.spki_fingerprint_mismatch',
]);
const CPU_CODES = new Set(['policy.debug_enabled', 'policy.tcb_status_not_allowed']);
const KEY_AREAS = new Set(['binding', 'measurement', 'provenance', 'e2ee', 'input']);

/**
 * The check an inference SDK failure code belongs to, for servers that do not report
 * `checks`. The Gateway and the model are verified in parallel and the first failure ends
 * the run, so only that check is known to have failed. `api.*` codes mean the evidence
 * never arrived, so no check is blamed.
 */
export function failedCheck(code?: string): DeploymentCheck | undefined {
  if (!code) {
    return undefined;
  }
  const area = code.split('.')[0];
  if (GATEWAY_CODES.has(code) || area === 'ohttp') {
    return 'gateway';
  }
  if (area === 'quote' || CPU_CODES.has(code)) {
    return 'cpu';
  }
  if (area === 'gpu' || code === 'policy.gpu_evidence_required') {
    return 'gpu';
  }
  if (KEY_AREAS.has(area) || code === 'policy.model_attestation_required') {
    return 'key';
  }
  return undefined;
}

export function deploymentState({
  data,
  isError,
  isChecking,
}: {
  data?: TNearAIAttestationResponse;
  isError: boolean;
  isChecking: boolean;
}): DeploymentState {
  const attestation = data?.enabled === true ? data : undefined;
  if (isChecking || (!attestation && !isError)) {
    return 'checking';
  }
  if (attestation?.status === 'verified') {
    return 'verified';
  }
  if (attestation?.status === 'failed') {
    return 'failed';
  }
  return 'unavailable';
}

/** The check that failed: the one the server marks, else the one the failure code names. */
export function failedDeploymentCheck(report?: DeploymentReport): DeploymentCheck | undefined {
  if (report?.checks) {
    return DEPLOYMENT_CHECKS.find((check) => report.checks?.[check] === 'failed');
  }
  return failedCheck(report?.errorCode);
}

/** Whether checks ran and one did not pass, as opposed to evidence that never arrived. */
export function isCheckFailure(code?: string): boolean {
  return !!code && code !== 'unknown' && !code.startsWith('api.');
}

/**
 * Row states for the deployment checks. While checking, every row is in flight at once,
 * which is how the SDK runs them. Once answered, each row takes the server's outcome; on
 * servers without `checks`, a failure marks only the check its code names, and a pass
 * leaves GPU unconfirmed, since the SDK passes a model that sent no GPU evidence.
 */
export function deploymentChecks(
  state: DeploymentState,
  report: DeploymentReport = {},
): Record<DeploymentCheck, CheckState> {
  const { checks } = report;
  const failed = state === 'failed' && !checks ? failedCheck(report.errorCode) : undefined;
  const rowState = (check: DeploymentCheck): CheckState => {
    if (state === 'checking') {
      return 'active';
    }
    if (checks) {
      const outcome = checks[check];
      return (outcome && outcomeStates[outcome]) ?? 'skip';
    }
    if (state === 'verified') {
      return check === 'gpu' ? 'skip' : 'done';
    }
    return check === failed ? 'fail' : 'skip';
  };
  return {
    gateway: rowState('gateway'),
    cpu: rowState('cpu'),
    gpu: rowState('gpu'),
    key: rowState('key'),
  };
}

export type CheckedAt = { justNow: true } | { justNow: false; label: string };

/** When a check ran: just now within a minute, the time today, else the date and time. */
export function formatCheckedAt(iso: string | undefined, now = new Date()): CheckedAt | undefined {
  const at = new Date(iso ?? '');
  if (Number.isNaN(at.getTime())) {
    return undefined;
  }
  if (now.getTime() - at.getTime() < 60_000) {
    return { justNow: true };
  }
  const time: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  const label =
    at.toDateString() === now.toDateString()
      ? at.toLocaleTimeString([], time)
      : at.toLocaleString([], { ...time, month: 'short', day: 'numeric' });
  return { justNow: false, label };
}

export function getReceipts(message: TMessage): TNearAIReceipt[] {
  const nearai = message.metadata?.nearai as { receipts?: TNearAIReceipt[] } | undefined;
  return Array.isArray(nearai?.receipts) ? nearai.receipts : [];
}

/** The SDK's codes for a reply with no signature to check, rather than one that failed. */
const NO_SIGNATURE_CODES = new Set([
  'api.completion_not_found',
  'api.completion_signature_unavailable',
]);

/** Which kind of key signed these receipts; the weakest signer speaks for the reply. */
export function signerKind(receipts: TNearAIReceipt[]): SignerKind {
  const kinds = receipts.map((receipt) => receipt.signatureKind);
  if (kinds.some((kind) => kind !== 'provider_tee' && kind !== 'gateway')) {
    return 'unclassified';
  }
  return kinds.includes('gateway') ? 'gateway' : 'model';
}

export function replyState(receipts: TNearAIReceipt[], edited = false): ReplyState {
  const notVerified = receipts.filter((receipt) => receipt.status !== 'verified');
  if (notVerified.some((receipt) => !NO_SIGNATURE_CODES.has(receipt.errorCode ?? ''))) {
    return 'failed';
  }
  if (notVerified.length > 0) {
    return 'unsigned';
  }
  if (edited) {
    return 'edited';
  }
  const kind = signerKind(receipts);
  return kind === 'model' ? 'verified' : kind;
}

/** A reply's text and reasoning parts; other user-submitted paths are tool input and steers. */
const REPLY_TEXT_PATH = /^\/(text|content\/\d+\/(text|think))$/;

/** Whether someone changed this reply's text in the app, which the server records per path. */
export function isReplyEdited(message: TMessage): boolean {
  return message.userSubmittedPaths?.some((path) => REPLY_TEXT_PATH.test(path)) ?? false;
}

export type SignedHashes = { request: string; response: string };

/**
 * The request and response hashes in a signature's text, which reads
 * `<model>:<request>:<response>` from the model and `<request>:<response>` from the Gateway.
 */
export function signedHashes(signedText?: string): SignedHashes | undefined {
  const match = /(?:^|:)([0-9a-f]{64}):([0-9a-f]{64})$/i.exec(signedText ?? '');
  return match ? { request: match[1], response: match[2] } : undefined;
}
