import { createElement } from 'react';
import axios from 'axios';
import { QueryKeys } from 'librechat-data-provider';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useUpdateUserKeysMutation,
  useRevokeUserKeyMutation,
  useRevokeAllUserKeysMutation,
} from 'librechat-data-provider/react-query';
import type { ReactNode } from 'react';

const endpoint = 'NEAR AI';
const statusKey = [QueryKeys.nearaiAttestation, endpoint, 'model'];
const reportKey = [...statusKey, 'reports'];
const otherEndpointKey = [QueryKeys.nearaiAttestation, 'Other', 'model', 'reports'];
const success = { enabled: true, status: 'verified' };

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const key of [statusKey, reportKey, [...reportKey, 'gateway'], otherEndpointKey]) {
    client.setQueryData(key, success);
  }
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  const { result } = renderHook(
    () => ({
      save: useUpdateUserKeysMutation(),
      revoke: useRevokeUserKeyMutation(endpoint),
      revokeAll: useRevokeAllUserKeysMutation(),
    }),
    { wrapper },
  );
  return { client, result };
}

beforeEach(() => {
  jest.spyOn(axios, 'put').mockResolvedValue({ data: {} });
  jest.spyOn(axios, 'delete').mockResolvedValue({ data: {} });
});

it.each(['save', 'revoke', 'revokeAll'] as const)(
  'clears prior credential evidence after %s succeeds',
  async (operation) => {
    const { client, result } = setup();
    await act(async () => {
      if (operation === 'save') {
        await result.current.save.mutateAsync({ name: endpoint, value: 'new-key', expiresAt: '' });
      } else {
        await result.current[operation].mutateAsync(undefined);
      }
    });
    expect(client.getQueryData(statusKey)).toBeUndefined();
    expect(client.getQueryData(reportKey)).toBeUndefined();
    expect(client.getQueryData([...reportKey, 'gateway'])).toBeUndefined();
    expect(client.getQueryData(otherEndpointKey)).toEqual(
      operation === 'revokeAll' ? undefined : success,
    );
  },
);

it('prevents a report requested with an old key from restoring evidence after a key change', async () => {
  const { client, result } = setup();
  let resolve!: (value: typeof success) => void;
  const pending = new Promise<typeof success>((done) => {
    resolve = done;
  });
  const oldRequest = client.fetchQuery(reportKey, () => pending).catch(() => undefined);
  await act(async () => {
    await result.current.save.mutateAsync({ name: endpoint, value: 'new-key', expiresAt: '' });
    resolve(success);
    await oldRequest;
  });
  expect(client.getQueryData(reportKey)).toBeUndefined();
});

it('preserves evidence when the credential update itself fails', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.mocked(axios.put).mockRejectedValue(new Error('offline'));
  const { client, result } = setup();
  await act(async () => {
    await expect(
      result.current.save.mutateAsync({ name: endpoint, value: 'new-key', expiresAt: '' }),
    ).rejects.toThrow('offline');
  });
  expect(client.getQueryData(reportKey)).toEqual(success);
});
