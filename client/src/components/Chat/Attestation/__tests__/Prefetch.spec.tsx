import React from 'react';
import { request } from 'librechat-data-provider';
import { act, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TMessage, TNearAIReceipt } from 'librechat-data-provider';
import { receipt, modelReport, gatewayReport } from 'test/fixtures/nearai';
import { prefetchReport, reportQueryOptions } from '../queries';
import Prefetch from '../Prefetch';

function message(
  id: string,
  model = receipt.model,
  scope: 'model' | 'gateway' = 'model',
  endpoint = 'NEAR AI',
): TMessage {
  const saved: TNearAIReceipt = {
    ...receipt,
    model,
    completionId: id,
    report: {
      ...receipt.report!,
      kind: 'reply',
      model,
      completionId: id,
      scope,
      ...(scope === 'gateway'
        ? {
            status: 'partial',
            attestation: gatewayReport.attestation,
            signature: { ...receipt.report!.signature!, kind: 'gateway' },
          }
        : {}),
    },
  };
  return {
    messageId: id,
    conversationId: 'chat',
    parentMessageId: 'parent',
    sender: 'NEAR AI',
    text: 'OK',
    isCreatedByUser: false,
    endpoint,
    metadata: { nearai: { receipts: [saved] } },
  };
}

function setup(messages: TMessage[], isSubmitting = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const content = (items: TMessage[], submitting: boolean) => (
    <QueryClientProvider client={client}>
      <Prefetch messages={items} isSubmitting={submitting} />
    </QueryClientProvider>
  );
  const rendered = render(content(messages, isSubmitting));
  return {
    client,
    update: (items: TMessage[], submitting = false) =>
      rendered.rerender(content(items, submitting)),
  };
}

beforeEach(() => {
  jest.spyOn(request, 'get').mockImplementation(async (url) => {
    const parsed = new URL(String(url), 'http://localhost');
    const model = parsed.searchParams.get('model');
    return {
      enabled: true,
      model,
      status: 'verified',
      checkedAt: modelReport.verifiedAt,
      reports: [{ ...modelReport, model }],
    };
  });
});

it('prefetches once per endpoint/model/scope across a loaded message list', async () => {
  const messages = [
    message('qwen', 'Qwen/Qwen3.6-35B-A3B-FP8'),
    message('glm'),
    message('external', 'openai/gpt-4.1-mini', 'gateway'),
    message('chutes', 'deepseek/deepseek-v3.2', 'gateway'),
    message('duplicate'),
    message('gateway-scope', receipt.model, 'gateway'),
    message('other-endpoint', receipt.model, 'model', 'NEAR AI 2'),
  ];
  const { client, update } = setup(messages);
  await waitFor(() => expect(request.get).toHaveBeenCalledTimes(6));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  const urls = jest
    .mocked(request.get)
    .mock.calls.map(([url]) => new URL(String(url), 'http://localhost'));
  expect(
    urls.every(
      (url) => url.searchParams.get('reports') === '1' && !url.searchParams.has('refresh'),
    ),
  ).toBe(true);
  expect(urls.filter((url) => url.searchParams.get('scope') === 'gateway')).toHaveLength(3);
  expect(urls.some((url) => url.searchParams.get('endpoint') === 'NEAR AI 2')).toBe(true);
  await act(async () => update([...messages, message('new-reply')]));
  expect(request.get).toHaveBeenCalledTimes(6);
});

it('warms restored history during generation, skips token updates, then prefetches completed reply models', async () => {
  const initial = [message('old')];
  const { client, update } = setup(initial, true);
  await waitFor(() => expect(request.get).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  const next = [...initial, message('new', 'Qwen/Qwen3.6-35B-A3B-FP8')];
  update(next, true);
  expect(request.get).toHaveBeenCalledTimes(1);
  update(next);
  await waitFor(() => expect(request.get).toHaveBeenCalledTimes(2));
  update(
    [{ ...message('restored', 'deepseek/deepseek-v3.2', 'gateway'), conversationId: 'other-chat' }],
    true,
  );
  await waitFor(() => expect(request.get).toHaveBeenCalledTimes(3));
});

it('skips messages without usable server-owned verification reports', async () => {
  const base = message('base');
  const invalid = { ...receipt, report: { ...receipt.report!, completionId: 'wrong-completion' } };
  setup([
    { ...base, endpoint: 'OpenAI', metadata: {} },
    { ...base, isCreatedByUser: true },
    { ...base, isUserSubmitted: true },
    { ...base, userSubmittedPaths: ['/text'] },
    { ...base, userSubmittedMessageFieldPaths: [{ path: '/content/0', field: 'answer' }] },
    { ...base, endpoint: undefined },
    { ...base, metadata: { nearai: { receipts: [{ ...receipt, report: undefined }, invalid] } } },
  ]);
  await act(async () => {});
  expect(request.get).not.toHaveBeenCalled();
});

it.each(['failed', 'unverifiable', 'network'] as const)(
  'does not automatically retry a %s prefetch on later message updates',
  async (failure) => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.mocked(request.get).mockImplementation(async () => {
      if (failure === 'network') throw new Error('offline');
      return {
        enabled: true,
        model: receipt.model,
        status: 'failed',
        checkedAt: modelReport.verifiedAt,
        reports: [{ ...modelReport, status: failure }],
      };
    });
    const messages = [message('old')];
    const { client, update } = setup(messages);
    await waitFor(() => expect(request.get).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(client.isFetching()).toBe(0));
    await act(async () => update([...messages, message('new')]));
    expect(request.get).toHaveBeenCalledTimes(1);
  },
);

it('preserves invalidated evidence and refreshes only expired successful reports in the background', async () => {
  const client = new QueryClient();
  const params = { endpoint: 'NEAR AI', model: receipt.model };
  const key = reportQueryOptions(client, params).queryKey;
  await prefetchReport(client, params);
  expect(request.get).toHaveBeenCalledTimes(1);
  await client.invalidateQueries({ queryKey: key, exact: true, refetchType: 'none' });
  await prefetchReport(client, params);
  expect(request.get).toHaveBeenCalledTimes(1);
  client.removeQueries({ queryKey: key, exact: true });
  await prefetchReport(client, params);
  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 300_001);
  await prefetchReport(client, params);
  expect(request.get).toHaveBeenCalledTimes(3);
});

it('shares one report request between the model shield and full-scope replies of the same model', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const shield = prefetchReport(client, { endpoint: 'NEAR AI', model: receipt.model });
  render(
    <QueryClientProvider client={client}>
      <Prefetch messages={[message('model-scope')]} isSubmitting={false} />
    </QueryClientProvider>,
  );
  await shield;
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(request.get).toHaveBeenCalledTimes(1);
  const gatewayKey = reportQueryOptions(client, {
    endpoint: 'NEAR AI',
    model: receipt.model,
    scope: 'gateway',
  }).queryKey;
  expect(gatewayKey).not.toEqual(
    reportQueryOptions(client, { endpoint: 'NEAR AI', model: receipt.model }).queryKey,
  );
});
