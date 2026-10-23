import type { Response } from 'express';
import type { ServerRequest } from '~/types';
import { getNearAICredentials, verifyNearAIModel } from './attestation';

/**
 * GET /api/nearai/attestation?endpoint=<name>&model=<id>[&refresh=1]
 * Verifies the NEAR AI Gateway and model deployment with the inference SDK.
 * Non-NEAR endpoints answer `{ enabled: false }` so the client can hide the shield.
 * `verifyUrl` (from NEAR_AI_VERIFY_URL) is the NEAR AI page both shields link to.
 */
export async function nearAIAttestationHandler(
  req: ServerRequest,
  res: Response,
): Promise<Response> {
  const { endpoint, model, refresh } = req.query;
  if (typeof endpoint !== 'string' || typeof model !== 'string' || !endpoint || !model) {
    return res.status(400).json({ message: 'endpoint and model are required' });
  }
  const credentials = getNearAICredentials(req.config, endpoint);
  if (!credentials) {
    return res.json({ enabled: false });
  }
  const status = await verifyNearAIModel(credentials, model, refresh === '1');
  /** SDK messages can name upstream URLs; the client only needs the stable code. */
  const { message: _message, ...safeStatus } = status;
  const verifyUrl = process.env.NEAR_AI_VERIFY_URL || undefined;
  return res.json({ enabled: true, ...safeStatus, verifyUrl });
}
