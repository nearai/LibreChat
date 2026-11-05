import type { TMessage, TNearAIReceipt } from 'librechat-data-provider';
import type { DeploymentReport } from '../proof';
import {
  replyState,
  signerKind,
  failedCheck,
  signedHashes,
  isReplyEdited,
  isCheckFailure,
  deploymentState,
  formatCheckedAt,
  deploymentChecks,
  failedDeploymentCheck,
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
  const notChecked = {
    gateway: 'not_checked',
    cpu: 'not_checked',
    gpu: 'not_checked',
    key: 'not_checked',
  } as const;

  it('runs every check at once, the way the SDK does', () => {
    expect(Object.values(deploymentChecks('checking'))).toEqual([
      'active',
      'active',
      'active',
      'active',
    ]);
  });

  it('keeps every check in flight while re-checking over an earlier answer', () => {
    const report: DeploymentReport = { checks: { ...notChecked, gpu: 'failed' } };
    expect(Object.values(deploymentChecks('checking', report))).toEqual(Array(4).fill('active'));
  });

  describe("with the server's per-check outcomes", () => {
    it('flags GPU evidence that was never sent on a verified deployment', () => {
      const report: DeploymentReport = {
        checks: { gateway: 'passed', cpu: 'passed', gpu: 'not_provided', key: 'passed' },
      };
      expect(deploymentChecks('verified', report)).toEqual({
        gateway: 'done',
        cpu: 'done',
        gpu: 'warn',
        key: 'done',
      });
    });

    it('marks the check the server names, not the one the code suggests', () => {
      const report: DeploymentReport = {
        errorCode: 'quote.verification_failed',
        checks: { ...notChecked, gateway: 'failed' },
      };
      expect(deploymentChecks('failed', report)).toEqual({
        gateway: 'fail',
        cpu: 'skip',
        gpu: 'skip',
        key: 'skip',
      });
    });

    it('blames nothing when the server could not tell whose evidence failed', () => {
      const report: DeploymentReport = {
        errorCode: 'policy.tcb_status_not_allowed',
        checks: notChecked,
      };
      expect(Object.values(deploymentChecks('failed', report))).toEqual(Array(4).fill('skip'));
    });

    it('leaves an outcome it does not know unconfirmed', () => {
      const report = {
        checks: { gateway: 'passed', cpu: 'passed', gpu: 'attested_later', key: 'passed' },
      } as unknown as DeploymentReport;
      expect(deploymentChecks('verified', report).gpu).toBe('skip');
    });
  });

  describe('on servers that predate per-check outcomes', () => {
    it('passes every check when verified, except GPU, which a pass does not establish', () => {
      expect(deploymentChecks('verified')).toEqual({
        gateway: 'done',
        cpu: 'done',
        gpu: 'skip',
        key: 'done',
      });
    });

    it('marks only the failed check and leaves the rest unconfirmed', () => {
      expect(deploymentChecks('failed', { errorCode: 'gpu.attestation_rejected' })).toEqual({
        gateway: 'skip',
        cpu: 'skip',
        gpu: 'fail',
        key: 'skip',
      });
    });

    it('blames nothing for an unattributable failure', () => {
      const states = deploymentChecks('failed', { errorCode: 'api.http_status' });
      expect(Object.values(states)).not.toContain('fail');
    });
  });
});

describe('failedDeploymentCheck', () => {
  it("takes the server's failed check over the code's area", () => {
    const report: DeploymentReport = {
      errorCode: 'quote.verification_failed',
      checks: { gateway: 'failed', cpu: 'not_checked', gpu: 'not_checked', key: 'not_checked' },
    };
    expect(failedDeploymentCheck(report)).toBe('gateway');
  });

  it('names none when the server blames none', () => {
    const report: DeploymentReport = {
      errorCode: 'quote.verification_failed',
      checks: {
        gateway: 'not_checked',
        cpu: 'not_checked',
        gpu: 'not_checked',
        key: 'not_checked',
      },
    };
    expect(failedDeploymentCheck(report)).toBeUndefined();
  });

  it("falls back to the code's area without server checks", () => {
    expect(failedDeploymentCheck({ errorCode: 'quote.verification_failed' })).toBe('cpu');
    expect(failedDeploymentCheck(undefined)).toBeUndefined();
  });
});

describe('isCheckFailure', () => {
  it('tells a check that did not pass from evidence that never arrived', () => {
    expect(isCheckFailure('policy.tcb_status_not_allowed')).toBe(true);
    expect(isCheckFailure('api.transport_failed')).toBe(false);
    expect(isCheckFailure('unknown')).toBe(false);
    expect(isCheckFailure(undefined)).toBe(false);
  });
});

describe('reply proof', () => {
  it('is verified when the model signed every completion', () => {
    expect(replyState([receipt(), receipt({ completionId: 'chatcmpl-2' })])).toBe('verified');
  });

  it('warns when the Gateway signed instead of the model', () => {
    expect(replyState([receipt(), receipt({ signatureKind: 'gateway' })])).toBe('gateway');
  });

  it('does not take a missing or unknown signature kind for the Gateway', () => {
    expect(replyState([receipt({ signatureKind: undefined })])).toBe('unclassified');
    expect(
      replyState([receipt({ signatureKind: 'other' as TNearAIReceipt['signatureKind'] })]),
    ).toBe('unclassified');
  });

  it('fails when any signature failed', () => {
    const receipts = [receipt(), receipt({ status: 'failed', errorCode: 'signature.invalid' })];
    expect(replyState(receipts)).toBe('failed');
  });

  it('fails on an error it cannot read as a missing signature', () => {
    for (const errorCode of ['api.transport_failed', 'unknown', undefined]) {
      expect(replyState([receipt({ status: 'failed', errorCode })])).toBe('failed');
    }
  });

  it('is unsigned when no signature was available', () => {
    for (const errorCode of ['api.completion_signature_unavailable', 'api.completion_not_found']) {
      expect(replyState([receipt({ status: 'failed', errorCode })])).toBe('unsigned');
    }
  });

  it('lets a real failure outrank a missing signature', () => {
    expect(
      replyState([
        receipt({ status: 'failed', errorCode: 'api.completion_not_found' }),
        receipt({ status: 'failed', errorCode: 'signature.payload_mismatch' }),
      ]),
    ).toBe('failed');
  });

  it('is edited once the text changes, unless the signature itself did not stand', () => {
    expect(replyState([receipt()], true)).toBe('edited');
    expect(replyState([receipt({ signatureKind: 'gateway' })], true)).toBe('edited');
    expect(replyState([receipt({ status: 'failed', errorCode: 'signature.invalid' })], true)).toBe(
      'failed',
    );
    expect(
      replyState([receipt({ status: 'failed', errorCode: 'api.completion_not_found' })], true),
    ).toBe('unsigned');
  });
});

describe('signerKind', () => {
  it('lets the weakest signer speak for the reply', () => {
    expect(signerKind([receipt()])).toBe('model');
    expect(signerKind([receipt(), receipt({ signatureKind: 'gateway' })])).toBe('gateway');
    expect(
      signerKind([receipt({ signatureKind: 'gateway' }), receipt({ signatureKind: undefined })]),
    ).toBe('unclassified');
  });
});

describe('isReplyEdited', () => {
  const message = (userSubmittedPaths?: string[]) => ({ userSubmittedPaths }) as TMessage;

  it('sees edits to the text and to text or reasoning parts', () => {
    expect(isReplyEdited(message(['/text']))).toBe(true);
    expect(isReplyEdited(message(['/content/0/text']))).toBe(true);
    expect(isReplyEdited(message(['/content/12/think']))).toBe(true);
  });

  it('ignores tool input and steers the user added during the run', () => {
    expect(isReplyEdited(message(['/content/3']))).toBe(false);
    expect(isReplyEdited(message(['/content/3/tool_call/args']))).toBe(false);
    expect(isReplyEdited(message(['/content/3/tool_call/output']))).toBe(false);
  });

  it('is false for a reply nobody touched', () => {
    expect(isReplyEdited(message())).toBe(false);
    expect(isReplyEdited(message([]))).toBe(false);
  });
});

describe('signedHashes', () => {
  const request = 'a'.repeat(64);
  const response = 'B'.repeat(64);

  it("reads the Gateway's text", () => {
    expect(signedHashes(`${request}:${response}`)).toEqual({ request, response });
  });

  it("reads the model's text, whose name may itself hold a colon", () => {
    expect(signedHashes(`z-ai/glm-5.3-flash:${request}:${response}`)).toEqual({
      request,
      response,
    });
    expect(signedHashes(`org/model:free:${request}:${response}`)).toEqual({ request, response });
  });

  it('has nothing to say about any other text', () => {
    expect(signedHashes(undefined)).toBeUndefined();
    expect(signedHashes('')).toBeUndefined();
    expect(signedHashes('sha256:request:sha256:response')).toBeUndefined();
    expect(signedHashes(`${request}:short`)).toBeUndefined();
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
