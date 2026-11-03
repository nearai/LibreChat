import type { TMessage, TNearAIAttestationResponse, TNearAIReceipt } from 'librechat-data-provider';

/** The checks behind a deployment proof, in the order the popover lists them. */
export const DEPLOYMENT_CHECKS = ['gateway', 'cpu', 'gpu', 'key'] as const;
export type DeploymentCheck = (typeof DEPLOYMENT_CHECKS)[number];

/** The checks behind one reply's proof. */
export const REPLY_CHECKS = ['signature', 'signer', 'model'] as const;
export type ReplyCheck = (typeof REPLY_CHECKS)[number];

export type CheckState = 'done' | 'active' | 'fail' | 'warn' | 'skip';

export type DeploymentState = 'checking' | 'verified' | 'failed' | 'unavailable';

/** `gateway`: the signature is valid, but the Gateway signed it rather than the model. */
export type ReplyState = 'verified' | 'gateway' | 'failed';

const GATEWAY_CODES = new Set([
  'binding.spki_fingerprint_required',
  'binding.spki_fingerprint_mismatch',
]);
const CPU_CODES = new Set(['policy.debug_enabled', 'policy.tcb_status_not_allowed']);
const KEY_AREAS = new Set(['binding', 'measurement', 'provenance', 'e2ee', 'input']);

/**
 * The check an inference SDK failure code belongs to. The Gateway and the model are
 * verified in parallel and the first failure ends the run, so only that check is known
 * to have failed. `api.*` codes mean the evidence never arrived, so no check is blamed.
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

/**
 * Row states for the deployment checks. While checking, every row is in flight at once,
 * which is how the SDK runs them; on failure only the check the code names is marked.
 */
export function deploymentChecks(
  state: DeploymentState,
  errorCode?: string,
): Record<DeploymentCheck, CheckState> {
  const failed = state === 'failed' ? failedCheck(errorCode) : undefined;
  const rowState = (check: DeploymentCheck): CheckState => {
    if (state === 'verified') {
      return 'done';
    }
    if (state === 'checking') {
      return 'active';
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

export function replyState(receipts: TNearAIReceipt[]): ReplyState {
  if (receipts.some((receipt) => receipt.status !== 'verified')) {
    return 'failed';
  }
  if (receipts.some((receipt) => receipt.signatureKind !== 'provider_tee')) {
    return 'gateway';
  }
  return 'verified';
}

export function replyChecks(state: ReplyState): Record<ReplyCheck, CheckState> {
  if (state === 'failed') {
    return { signature: 'fail', signer: 'skip', model: 'skip' };
  }
  return { signature: 'done', signer: state === 'gateway' ? 'warn' : 'done', model: 'done' };
}

/** The key a reply's seal is drawn from: the first verified signer among its receipts. */
export function replySealKey(receipts: TNearAIReceipt[]): string | undefined {
  return receipts.find((receipt) => receipt.status === 'verified' && receipt.signingAddress)
    ?.signingAddress;
}

/**
 * The model key behind the latest reply `model` signed in this conversation. The header
 * draws its seal from it, so every reply signed by that key wears the same seal. Scans
 * from the end, where the newest reply is, and stops at the first match.
 */
export function latestModelKey(
  messages: TMessage[] | undefined,
  model: string,
): string | undefined {
  if (!messages || !model) {
    return undefined;
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.isCreatedByUser || message.metadata?.nearai == null) {
      continue;
    }
    const receipt = getReceipts(message).find(
      (entry) =>
        entry.model === model &&
        entry.status === 'verified' &&
        entry.signatureKind === 'provider_tee' &&
        entry.signingAddress,
    );
    if (receipt) {
      return receipt.signingAddress;
    }
  }
  return undefined;
}
