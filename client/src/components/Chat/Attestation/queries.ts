import { dataService, QueryKeys } from 'librechat-data-provider';
import type { TNearAIAttestationParams, TNearAIAttestationResponse } from 'librechat-data-provider';
import type { QueryClient, QueryFunctionContext } from '@tanstack/react-query';
import { reportStaleTime } from './reports';

export function reportKey(params: Pick<TNearAIAttestationParams, 'endpoint' | 'model'>) {
  return [QueryKeys.nearaiAttestation, params.endpoint, params.model, 'reports'];
}

export function reportQueryOptions(
  client: QueryClient,
  params: Pick<TNearAIAttestationParams, 'endpoint' | 'model' | 'scope'>,
) {
  const queryKey = reportKey(params);
  const key = params.scope === 'gateway' ? [...queryKey, 'gateway'] : queryKey;
  const cached = client.getQueryState<TNearAIAttestationResponse>(key);
  return {
    queryKey: key,
    queryFn: ({ signal }: QueryFunctionContext) =>
      dataService.getNearAIAttestation({ ...params, reports: true }, signal),
    staleTime: reportStaleTime(cached?.data, cached?.status),
    cacheTime: 10 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  };
}

export function prefetchReport(
  client: QueryClient,
  params: Pick<TNearAIAttestationParams, 'endpoint' | 'model' | 'scope'>,
): Promise<void> | undefined {
  const options = reportQueryOptions(client, params);
  const cached = client.getQueryState<TNearAIAttestationResponse>(options.queryKey);
  // Failed checks are retried by the user, not by message updates or background warmup.
  if (
    cached?.status === 'error' ||
    cached?.isInvalidated ||
    (cached?.data && options.staleTime === 0) ||
    client.isMutating({ mutationKey: reportKey(params), exact: true })
  ) {
    return;
  }
  return client.prefetchQuery(options);
}
