import { useRecoilValue } from 'recoil';
import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';
import type t from 'librechat-data-provider';
import store from '~/store';

export const useGetBannerQuery = (
  config?: UseQueryOptions<t.TBannerResponse>,
): QueryObserverResult<t.TBannerResponse> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TBannerResponse>([QueryKeys.banner], () => dataService.getBanner(), {
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    ...config,
    enabled: (config?.enabled ?? true) === true && queriesEnabled,
  });
};

export const useGetUserBalance = (
  config?: UseQueryOptions<t.TBalanceResponse>,
): QueryObserverResult<t.TBalanceResponse> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TBalanceResponse>([QueryKeys.balance], () => dataService.getUserBalance(), {
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: true,
    ...config,
    enabled: (config?.enabled ?? true) === true && queriesEnabled,
  });
};

/** NEAR AI deployment attestation for one endpoint/model; the server answers `enabled: false` for others. */
export const useNearAIAttestationQuery = (
  params: { endpoint: string; model: string },
  config?: UseQueryOptions<t.TNearAIAttestationResponse>,
): QueryObserverResult<t.TNearAIAttestationResponse> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<t.TNearAIAttestationResponse>(
    [QueryKeys.nearaiAttestation, params.endpoint, params.model],
    () => dataService.getNearAIAttestation(params),
    {
      refetchOnWindowFocus: true,
      refetchInterval: 5 * 60 * 1000,
      retry: false,
      ...config,
      enabled:
        (config?.enabled ?? true) === true && queriesEnabled && !!params.endpoint && !!params.model,
    },
  );
};

export const useGetSearchEnabledQuery = (
  config?: UseQueryOptions<boolean>,
): QueryObserverResult<boolean> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<boolean>([QueryKeys.searchEnabled], () => dataService.getSearchEnabled(), {
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    ...config,
    enabled: (config?.enabled ?? true) === true && queriesEnabled,
  });
};
