import { logger } from '@librechat/data-schemas';
import { EModelEndpoint, extractEnvVariable } from 'librechat-data-provider';
import type { TStartupConfig } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { ServerRequest, GetUserKeyValuesFunction } from '~/types';
import type { NearAICredentials } from './attestation';
import {
  isNearAIBaseURL,
  verifyNearAIModel,
  getNearAICredentials,
  verifyNearAIModelReports,
} from './attestation';
import { getSafeErrorMetadata } from '~/utils/errors';

export function getNearAIVerificationConfig(
  verifyUrl: string | undefined,
  appConfig?: AppConfig,
): Required<Pick<TStartupConfig, 'nearaiVerifyUrl' | 'nearaiEndpoints'>> {
  const custom = appConfig?.endpoints?.[EModelEndpoint.custom] ?? [];
  const nearaiEndpoints = custom.flatMap(({ name, baseURL }) =>
    name && isNearAIBaseURL(extractEnvVariable(baseURL ?? '')) ? [name] : [],
  );
  return {
    nearaiVerifyUrl: verifyUrl?.trim() || 'https://cloud-stg.near.ai/verify',
    nearaiEndpoints,
  };
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
  req: Pick<ServerRequest, 'query' | 'config'> & { user?: { id: string } },
  res: Response,
  getUserKeyValues?: GetUserKeyValuesFunction,
): Promise<Response> {
  res.set('Cache-Control', 'no-store');
  const { endpoint, model, refresh } = req.query;
  if (typeof endpoint !== 'string' || typeof model !== 'string' || !endpoint || !model) {
    return res.status(400).json({ message: 'endpoint and model are required' });
  }
  let credentials: NearAICredentials | undefined;
  try {
    credentials = await getNearAICredentials(req.config, endpoint, {
      userId: req.user?.id,
      getUserKeyValues,
    });
  } catch (error) {
    logger.warn('[nearai] Credential resolution failed', getSafeErrorMetadata(error));
    return res.status(503).json({ error: { code: 'nearai_credentials_unavailable' } });
  }
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
