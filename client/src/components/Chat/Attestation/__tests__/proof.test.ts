import type { TMessage, TNearAIReceipt } from 'librechat-data-provider';
import {
  deploymentChecks,
  deploymentState,
  failedCheck,
  formatCheckedAt,
  latestModelKey,
  replyChecks,
  replySealKey,
  replyState,
} from '../proof';

const receipt = (overrides: Partial<TNearAIReceipt> = {}): TNearAIReceipt => ({
  completionId: 'chatcmpl-1',
  model: 'z-ai/glm-5.3-flash',
  status: 'verified',
  verifiedAt: '2026-11-02T22:18:00.000Z',
  signatureKind: 'provider_tee',
  signingAlgo: 'ed25519',
  signingAddress: 'aa'.repeat(32),
  ...overrides,
});

const reply = (receipts: TNearAIReceipt[], overrides: Partial<TMessage> = {}): TMessage =>
  ({
    messageId: `m-${Math.random()}`,
    conversationId: 'c-1',
    isCreatedByUser: false,
    text: 'reply',
    metadata: { nearai: { receipts } },
    ...overrides,
  }) as TMessage;

describe('failedCheck', () => {
  it.each([
    ['binding.spki_fingerprint_mismatch', 'gateway'],
    ['ohttp.signature_invalid', 'gateway'],
    ['quote.verification_failed', 'cpu'],
    ['policy.tcb_status_not_allowed', 'cpu'],
    ['gpu.attestation_rejected', 'gpu'],
    ['policy.gpu_evidence_required', 'gpu'],
    ['measurement.rtmr3_mismatch', 'key'],
    ['e2ee.model_public_key_required', 'key'],
    ['policy.model_attestation_required', 'key'],
  ])('blames %s on the %s check', (code, check) => {
    expect(failedCheck(code)).toBe(check);
  });

  it('blames no check when the evidence never arrived', () => {
    expect(failedCheck('api.transport_failed')).toBeUndefined();
    expect(failedCheck('unknown')).toBeUndefined();
    expect(failedCheck(undefined)).toBeUndefined();
  });
});

describe('deploymentState', () => {
  const verified = {
    enabled: true as const,
    model: 'm',
    status: 'verified' as const,
    checkedAt: '2026-11-02T22:00:00.000Z',
  };

  it('is checking until an answer arrives', () => {
    expect(deploymentState({ data: undefined, isError: false, isChecking: false })).toBe(
      'checking',
    );
  });

  it('is checking while a re-check is in flight, even over a verified answer', () => {
    expect(deploymentState({ data: verified, isError: false, isChecking: true })).toBe('checking');
  });

  it('reports verified and failed answers', () => {
    expect(deploymentState({ data: verified, isError: false, isChecking: false })).toBe('verified');
    expect(
      deploymentState({
        data: { ...verified, status: 'failed', errorCode: 'gpu.attestation_rejected' },
        isError: false,
        isChecking: false,
      }),
    ).toBe('failed');
  });

  it('is unavailable when the check itself could not be reached', () => {
    expect(deploymentState({ data: undefined, isError: true, isChecking: false })).toBe(
      'unavailable',
    );
  });
});

describe('deploymentChecks', () => {
  it('runs every check at once, the way the SDK does', () => {
    expect(Object.values(deploymentChecks('checking'))).toEqual([
      'active',
      'active',
      'active',
      'active',
    ]);
  });

  it('marks only the failed check and leaves the rest unconfirmed', () => {
    expect(deploymentChecks('failed', 'gpu.attestation_rejected')).toEqual({
      gateway: 'skip',
      cpu: 'skip',
      gpu: 'fail',
      key: 'skip',
    });
  });

  it('blames nothing for an unattributable failure', () => {
    expect(Object.values(deploymentChecks('failed', 'api.http_status'))).not.toContain('fail');
  });
});

describe('reply proof', () => {
  it('is verified when the model signed every completion', () => {
    expect(replyState([receipt(), receipt({ completionId: 'chatcmpl-2' })])).toBe('verified');
  });

  it('warns when the Gateway signed instead of the model', () => {
    const receipts = [receipt(), receipt({ signatureKind: 'gateway' })];
    expect(replyState(receipts)).toBe('gateway');
    expect(replyChecks('gateway').signer).toBe('warn');
  });

  it('fails when any signature failed, and runs nothing after it', () => {
    const receipts = [receipt(), receipt({ status: 'failed', errorCode: 'signature.invalid' })];
    expect(replyState(receipts)).toBe('failed');
    expect(replyChecks('failed')).toEqual({ signature: 'fail', signer: 'skip', model: 'skip' });
  });

  it('draws the seal from the first verified signer', () => {
    const receipts = [
      receipt({ status: 'failed', signingAddress: undefined }),
      receipt({ signingAddress: 'bb'.repeat(32) }),
    ];
    expect(replySealKey(receipts)).toBe('bb'.repeat(32));
  });
});

describe('latestModelKey', () => {
  it('takes the newest model-signed reply for the model', () => {
    const messages = [
      reply([receipt({ signingAddress: 'old' })]),
      { messageId: 'u', isCreatedByUser: true, text: 'hi' } as TMessage,
      reply([receipt({ signingAddress: 'new' })]),
    ];
    expect(latestModelKey(messages, 'z-ai/glm-5.3-flash')).toBe('new');
  });

  it('skips Gateway signatures, failures and other models', () => {
    const messages = [
      reply([receipt({ signingAddress: 'model-key' })]),
      reply([receipt({ signatureKind: 'gateway', signingAddress: 'gateway-key' })]),
      reply([receipt({ status: 'failed', signingAddress: 'failed-key' })]),
      reply([receipt({ model: 'other/model', signingAddress: 'other-key' })]),
    ];
    expect(latestModelKey(messages, 'z-ai/glm-5.3-flash')).toBe('model-key');
  });

  it('has no key before the model signs a reply', () => {
    expect(latestModelKey([], 'z-ai/glm-5.3-flash')).toBeUndefined();
    expect(latestModelKey(undefined, 'z-ai/glm-5.3-flash')).toBeUndefined();
  });
});

describe('formatCheckedAt', () => {
  const now = new Date('2026-11-02T22:18:30.000Z');

  it('says just now within a minute', () => {
    expect(formatCheckedAt('2026-11-02T22:18:00.000Z', now)).toEqual({ justNow: true });
  });

  it('gives a time for an older check', () => {
    expect(formatCheckedAt('2026-11-02T21:00:00.000Z', now)).toMatchObject({ justNow: false });
  });

  it('has nothing to say about a missing or invalid time', () => {
    expect(formatCheckedAt(undefined, now)).toBeUndefined();
    expect(formatCheckedAt('not a date', now)).toBeUndefined();
  });
});
