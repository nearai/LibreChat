import type { TStartupConfig } from 'librechat-data-provider';
import type { Response } from 'express';
import type { ServerRequest } from '~/types';
import { getNearAICredentials, verifyNearAIModel, verifyNearAIModelReports } from './attestation';

export function getNearAIVerificationConfig(
  verifyUrl: string | undefined,
): Required<Pick<TStartupConfig, 'nearaiVerifyUrl'>> {
  return { nearaiVerifyUrl: verifyUrl?.trim() || 'https://cloud-stg.near.ai/verify' };
}

/**
 * GET /api/nearai/attestation?endpoint=<name>&model=<id>[&refresh=1][&reports=1]
 * `reports=1` fetches fresh display reports; the default reuses Chat's SDK cache.
 * `scope=gateway` checks Gateway evidence only, for Gateway-signed replies.
 * Verifies the NEAR AI Gateway and model deployment with the inference SDK.
 * Non-NEAR endpoints answer `{ enabled: false }` so the client can hide the shield.
 * `refresh=1` also resets Chat's SDK session to use the current deployment key.
 */
export async function nearAIAttestationHandler(
  req: Pick<ServerRequest, 'query' | 'config'>,
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
  if (req.query.reports === '1') {
    const scope = req.query.scope === 'gateway' ? 'gateway' : undefined;
    const reports = await verifyNearAIModelReports(credentials, model, {
      scope,
      refresh: refresh === '1',
    });
    const verified =
      reports.length > 0 &&
      reports.every((report) => ['verified', 'partial'].includes(report.status));
    let status = 'failed';
    if (verified)
      status = reports.some((report) => report.scope === 'model') ? 'verified' : 'partial';
    return res.json({
      enabled: true,
      model,
      status,
      checkedAt: new Date().toISOString(),
      reports,
    });
  }
  const status = await verifyNearAIModel(credentials, model, refresh === '1');
  return res.json({ enabled: true, ...status });
}
