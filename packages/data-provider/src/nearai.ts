import { z } from 'zod';

/** Limits imposed by the Cloud UI v1 iframe protocol. */
const MAX_REPORT_BYTES = 1024 * 1024;
const text = z.string().min(1).max(MAX_REPORT_BYTES);
export const DEFAULT_NEAR_AI_VERIFICATION_TIMEOUT_MS = 45_000;
export const MAX_NEAR_AI_VERIFICATION_TIMEOUT_MS = 120_000;
export const nearAIConfigSchema = z
  .object({
    verificationTimeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(MAX_NEAR_AI_VERIFICATION_TIMEOUT_MS)
      .default(DEFAULT_NEAR_AI_VERIFICATION_TIMEOUT_MS),
  })
  .strict();
const signer = z.object({
  signingAlgo: z.enum(['ed25519', 'ecdsa']),
  signingAddress: text,
});

/** Explicit display fields; deployment config and unknown fields are stripped. */
const report = z.object({
  schemaVersion: z.literal(1),
  completionId: text.optional(),
  model: z.preprocess((value) => (value === null ? undefined : value), text.optional()),
  scope: z.enum(['model', 'gateway', 'unknown']),
  status: z.enum(['verified', 'partial', 'failed', 'unverifiable']),
  verifiedAt: z.string().datetime({ offset: true }),
  signature: z
    .object({
      kind: z.enum(['provider_tee', 'gateway']),
      signer,
      signedText: text,
      signature: text,
    })
    .optional(),
  attestation: z
    .object({
      signer,
      tcbStatus: z.enum([
        'UpToDate',
        'SWHardeningNeeded',
        'ConfigurationNeeded',
        'ConfigurationAndSWHardeningNeeded',
        'OutOfDate',
        'OutOfDateConfigurationNeeded',
        'Revoked',
        'Unknown',
      ]),
      advisoryIds: z.array(text).max(1000),
      deploymentProvenance: z.enum(['verified', 'not_checked']),
      deployment: z.object({
        runtimeMeasurements: z.object({
          osImageHash: text.optional(),
          composeHash: text.optional(),
        }),
      }),
      gpuEvidence: z.enum(['verified', 'not_provided']).optional(),
      signingPublicKey: text.optional(),
      tlsBinding: z
        .discriminatedUnion('kind', [
          z.object({ kind: z.literal('none') }),
          z.object({ kind: z.literal('attested'), spkiFingerprint: text }),
        ])
        .optional(),
    })
    .optional(),
  error: z.object({ code: text, message: text }).optional(),
  evidence: z
    .object({
      intelQuote: text,
      nonce: text,
      eventLog: text,
      reportedQuoteData: text.optional(),
      nvidiaPayload: text.optional(),
    })
    .optional(),
});

export const nearAIVerificationReportSchema = z
  .discriminatedUnion('kind', [
    report.extend({ kind: z.literal('reply'), completionId: text }),
    report.extend({ kind: z.literal('model'), model: text }),
  ])
  .refine(
    (report) => new TextEncoder().encode(JSON.stringify([report])).length <= MAX_REPORT_BYTES,
    {
      message: 'Verification report exceeds the viewer limit',
    },
  );

export type TNearAIVerificationReport = z.infer<typeof nearAIVerificationReportSchema>;
