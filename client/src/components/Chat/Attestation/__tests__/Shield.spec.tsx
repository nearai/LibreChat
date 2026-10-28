import React from 'react';
import { RecoilRoot } from 'recoil';
import { ThemeProvider } from '@librechat/client';
import { request, QueryKeys } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TNearAIAttestationResponse } from 'librechat-data-provider';
import { report, modelReport, gatewayReport, viewerUrl } from 'test/fixtures/nearai';
import { ModelShield } from '../Shield';

jest.mock('~/hooks', () => ({
  useLocalize: jest.requireActual('~/hooks/useLocalize').default,
}));

const status = {
  enabled: true,
  model: 'z-ai/glm-5.3-flash',
  status: 'verified',
  checkedAt: report.verifiedAt,
} satisfies TNearAIAttestationResponse;

function setup(model = 'z-ai/glm-5.3-flash') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = render(
    <QueryClientProvider client={client}>
      <RecoilRoot>
        <ThemeProvider initialTheme="light">
          <ModelShield endpoint="NEAR AI" model={model} />
        </ThemeProvider>
      </RecoilRoot>
    </QueryClientProvider>,
  );
  return { ...rendered, client };
}

function reportRequests() {
  return jest.mocked(request.get).mock.calls.filter(([url]) => String(url).includes('reports=1'));
}

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  });
  jest.spyOn(request, 'get').mockImplementation(async (url) => {
    if (String(url).includes('reports=1')) return { ...status, reports: [modelReport] };
    if (String(url).includes('/nearai/attestation')) return status;
    return { nearaiVerifyUrl: viewerUrl };
  });
});

it('fetches full model reports only on click, sends them to the iframe, and restores focus on close', async () => {
  setup();
  const shield = await screen.findByRole('button', { name: 'NEAR AI attestation verified' });
  expect(reportRequests()).toHaveLength(0);
  fireEvent.click(shield);
  const frame = (await screen.findByTitle('NEAR AI Verification Center')) as HTMLIFrameElement;
  await waitFor(() => expect(frame.src).toContain('cloud-stg.near.ai'));
  const post = jest.spyOn(frame.contentWindow!, 'postMessage');
  act(() =>
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://cloud-stg.near.ai',
        source: frame.contentWindow,
        data: { type: 'NEAR_AI_VERIFICATION_CENTER_READY', version: 1, requestId: 'model-1' },
      }),
    ),
  );
  expect(post).toHaveBeenCalledWith(
    expect.objectContaining({ reports: [modelReport] }),
    'https://cloud-stg.near.ai',
  );
  expect(reportRequests()).toHaveLength(1);
  expect(reportRequests()[0][0]).toContain('refresh=1');
  act(() =>
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://cloud-stg.near.ai',
        source: frame.contentWindow,
        data: { type: 'NEAR_AI_VERIFICATION_CLOSE', version: 1, requestId: 'model-1' },
      }),
    ),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(shield).toHaveFocus());
});

it('requests fresh evidence when Verify again is clicked', async () => {
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'NEAR AI attestation verified' }));
  await screen.findByTitle('NEAR AI Verification Center');
  fireEvent.click(screen.getByRole('button', { name: 'Verify again' }));
  await waitFor(() => expect(reportRequests()).toHaveLength(2));
  expect(reportRequests().every(([url]) => String(url).includes('refresh=1'))).toBe(true);
  await screen.findByTitle('NEAR AI Verification Center');
});

it('shows loading in the first dialog commit before a report arrives', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const observed: string[] = [];
  const current = jest.mocked(request.get).getMockImplementation()!;
  let resolve!: (value: TNearAIAttestationResponse) => void;
  const delayed = new Promise<TNearAIAttestationResponse>((done) => {
    resolve = done;
  });
  jest
    .mocked(request.get)
    .mockImplementation((url, ...args) =>
      String(url).includes('reports=1') ? delayed : current(url, ...args),
    );
  render(
    <QueryClientProvider client={client}>
      <RecoilRoot>
        <ThemeProvider initialTheme="light">
          <React.Profiler
            id="verification"
            onRender={() => {
              const dialog = document.querySelector('[role="dialog"]');
              if (dialog) observed.push(dialog.textContent ?? '');
            }}
          >
            <ModelShield endpoint="NEAR AI" model="z-ai/glm-5.3-flash" />
          </React.Profiler>
        </ThemeProvider>
      </RecoilRoot>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'NEAR AI attestation verified' }));
  expect(observed.length).toBeGreaterThan(0);
  expect(observed[0]).toContain('Verifying hardware');
  expect(observed.every((text) => !text.includes('viewer is unavailable'))).toBe(true);
  await act(async () => resolve({ ...status, reports: [modelReport] }));
  await screen.findByTitle('NEAR AI Verification Center');
});

it('recovers from a report request failure without displaying stale verification', async () => {
  const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const get = jest.mocked(request.get);
  const implementation = get.getMockImplementation()!;
  let failed = false;
  get.mockImplementation(async (url, ...args) => {
    if (String(url).includes('reports=1') && !failed) {
      failed = true;
      throw new Error('offline');
    }
    return implementation(url, ...args);
  });
  setup();
  fireEvent.click(await screen.findByRole('button', { name: 'NEAR AI attestation verified' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not reach the verification service',
  );
  expect(screen.queryByTitle('NEAR AI Verification Center')).not.toBeInTheDocument();
  expect(logged).toHaveBeenCalledWith(expect.objectContaining({ message: 'offline' }));
  fireEvent.click(screen.getByRole('button', { name: 'Verify again' }));
  await screen.findByTitle('NEAR AI Verification Center');
});

it('hides the model shield when the endpoint does not support verification', async () => {
  jest.mocked(request.get).mockResolvedValue({ enabled: false });
  setup();
  await waitFor(() => expect(screen.queryByTestId('header-nearai-shield')).not.toBeInTheDocument());
  expect(reportRequests()).toHaveLength(0);
});

it('does not offer verification before the server confirms support', async () => {
  let resolve!: (value: { enabled: false }) => void;
  jest.mocked(request.get).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  setup();
  expect(screen.queryByTestId('header-nearai-shield')).not.toBeInTheDocument();
  await act(async () => resolve({ enabled: false }));
  expect(screen.queryByTestId('header-nearai-shield')).not.toBeInTheDocument();
  expect(reportRequests()).toHaveLength(0);
});

it('does not offer verification when endpoint support cannot be determined', async () => {
  const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.mocked(request.get).mockRejectedValue(new Error('offline'));
  setup();
  await waitFor(() => expect(logged).toHaveBeenCalled());
  expect(screen.queryByTestId('header-nearai-shield')).not.toBeInTheDocument();
  expect(reportRequests()).toHaveLength(0);
});

it('keeps a failed fresh report visible after a successful cached status poll', async () => {
  const original = jest.mocked(request.get).getMockImplementation()!;
  jest
    .mocked(request.get)
    .mockImplementation(async (url, ...args) =>
      String(url).includes('reports=1')
        ? { ...status, status: 'failed', reports: [{ ...modelReport, status: 'failed' }] }
        : original(url, ...args),
    );
  const { client } = setup();
  fireEvent.click(await screen.findByRole('button', { name: 'NEAR AI attestation verified' }));
  await screen.findByTitle('NEAR AI Verification Center');
  await waitFor(() =>
    expect(screen.getByTestId('header-nearai-shield')).toHaveAccessibleName(
      'NEAR AI attestation failed',
    ),
  );
  await act(async () => {
    await client.refetchQueries({
      queryKey: [QueryKeys.nearaiAttestation, 'NEAR AI', status.model],
      exact: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(screen.getByTestId('header-nearai-shield')).toHaveAccessibleName(
    'NEAR AI attestation failed',
  );
});

it('recovers from simultaneous status and report failures with one retry', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const original = jest.mocked(request.get).getMockImplementation()!;
  const { client } = setup();
  const shield = await screen.findByRole('button', { name: 'NEAR AI attestation verified' });
  jest.mocked(request.get).mockImplementation(async (url, ...args) => {
    if (String(url).includes('/nearai/attestation')) throw new Error('offline');
    return original(url, ...args);
  });
  await act(async () => {
    await client.refetchQueries({
      queryKey: [QueryKeys.nearaiAttestation, 'NEAR AI', status.model],
      exact: true,
    });
  });
  fireEvent.click(shield);
  await screen.findByRole('alert');
  jest.mocked(request.get).mockImplementation(original);
  fireEvent.click(screen.getByRole('button', { name: 'Verify again' }));
  await screen.findByTitle('NEAR AI Verification Center');
  await waitFor(() =>
    expect(screen.getByTestId('header-nearai-shield')).toHaveAccessibleName(
      'NEAR AI attestation verified',
    ),
  );
  expect(reportRequests()).toHaveLength(2);
});

it.each([
  ['Qwen/Qwen3.6-35B-A3B-FP8', 'verified'],
  ['z-ai/glm-5.3-flash', 'verified'],
  ['openai/gpt-4.1-mini', 'partial'],
  ['deepseek/deepseek-v3.2', 'partial'],
] as const)('displays the appropriate hardware scope for %s', async (model, verdict) => {
  const reports = (verdict === 'verified' ? [modelReport, gatewayReport] : [gatewayReport]).map(
    (entry) => ({ ...entry, model }),
  );
  jest.mocked(request.get).mockImplementation(async (url) =>
    String(url).includes('/nearai/attestation')
      ? {
          ...status,
          model,
          status: verdict,
          ...(String(url).includes('reports=1') ? { reports } : {}),
        }
      : { nearaiVerifyUrl: viewerUrl },
  );
  setup(model);
  const label =
    verdict === 'verified'
      ? 'NEAR AI attestation verified'
      : 'NEAR AI Gateway verified; model execution is not attested';
  fireEvent.click(await screen.findByRole('button', { name: label }));
  const frame = (await screen.findByTitle('NEAR AI Verification Center')) as HTMLIFrameElement;
  const post = jest.spyOn(frame.contentWindow!, 'postMessage');
  act(() =>
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://cloud-stg.near.ai',
        source: frame.contentWindow,
        data: { type: 'NEAR_AI_VERIFICATION_CENTER_READY', version: 1, requestId: 'scope' },
      }),
    ),
  );
  expect(post).toHaveBeenCalledWith(
    expect.objectContaining({ reports }),
    'https://cloud-stg.near.ai',
  );
  expect(new URL(frame.src).searchParams.get('model')).toBe(model);
});

it('closes the model dialog when its endpoint or model changes', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = (endpoint: string, model = status.model) => (
    <QueryClientProvider client={client}>
      <RecoilRoot>
        <ThemeProvider initialTheme="light">
          <ModelShield endpoint={endpoint} model={model} />
        </ThemeProvider>
      </RecoilRoot>
    </QueryClientProvider>
  );
  const current = jest.mocked(request.get).getMockImplementation()!;
  jest
    .mocked(request.get)
    .mockImplementation(async (url, ...args) =>
      String(url).includes('endpoint=Other') ? { enabled: false } : current(url, ...args),
    );
  const { rerender } = render(host('NEAR AI'));
  fireEvent.click(await screen.findByRole('button', { name: 'NEAR AI attestation verified' }));
  await screen.findByTitle('NEAR AI Verification Center');
  rerender(host('Other'));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  rerender(host('NEAR AI'));
  fireEvent.click(await screen.findByRole('button', { name: 'NEAR AI attestation verified' }));
  await screen.findByTitle('NEAR AI Verification Center');
  rerender(host('NEAR AI', 'other/model'));
  await screen.findByRole('button', { name: 'NEAR AI attestation verified' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
