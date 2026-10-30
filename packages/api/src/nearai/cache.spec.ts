import { InferenceClient } from '@nearai/inference-sdk/node';
import { createNearAIFetch, verifyNearAIModel, verifyNearAIModelReports } from './attestation';

const model = 'test/model';
const credentials = (apiKey: string) => ({ apiKey, baseURL: 'http://cloud-stg-api.near.ai/v1' });
const unavailable = (input: Parameters<typeof fetch>[0]) =>
  new URL(input instanceof Request ? input.url : String(input)).pathname.includes('/model/')
    ? Response.json({ metadata: { providerType: 'vllm', attestationSupported: true } })
    : new Response('{}', { status: 503 });

it.each([undefined, 'gateway'] as const)(
  'preserves Chat SDK sessions when reading display reports (scope: %s), including failures',
  async (scope) => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => unavailable(input));
    const verify = jest.spyOn(InferenceClient.prototype, 'verify');
    const own = credentials(`display-${scope}`);
    await verifyNearAIModel(own, model);
    await verifyNearAIModel(own, 'second/model');
    const original = verify.mock.contexts[0];
    const second = verify.mock.contexts[1];
    const reports = await verifyNearAIModelReports(own, model, { scope });
    expect(reports).toHaveLength(scope === 'gateway' ? 1 : 2);
    expect(reports.every((report) => report.status !== 'verified')).toBe(true);
    await verifyNearAIModel(own, model);
    await verifyNearAIModel(own, 'second/model');
    expect(verify.mock.contexts).toEqual([original, second, original, second]);
  },
);

it('invalidates only the requested model session on an explicit refresh, including failures', async () => {
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => unavailable(input));
  const verify = jest.spyOn(InferenceClient.prototype, 'verify');
  const own = credentials('refresh-test');
  const other = credentials('other-user');
  await verifyNearAIModel(own, model);
  await verifyNearAIModel(own, 'second/model');
  await verifyNearAIModel(other, model);
  const original = verify.mock.contexts[0];
  const otherClient = verify.mock.contexts[2];
  const second = verify.mock.contexts[1];
  expect(second).not.toBe(original);
  const reports = await verifyNearAIModelReports(own, model, { refresh: true });
  expect(reports).toHaveLength(2);
  expect(reports.every((report) => report.status !== 'verified')).toBe(true);
  await verifyNearAIModel(own, model);
  await verifyNearAIModel(own, 'second/model');
  await verifyNearAIModel(other, model);
  expect(verify.mock.contexts[3]).not.toBe(original);
  expect(verify.mock.contexts[4]).toBe(second);
  expect(verify.mock.contexts[5]).toBe(otherClient);
});

it('rechecks a session invalidated while its SDK verification was in flight', async () => {
  let release!: (response: Response) => void;
  let started!: () => void;
  const firstRequest = new Promise<void>((resolve) => {
    started = resolve;
  });
  let blocked = false;
  jest.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    if (
      !blocked &&
      !new URL(input instanceof Request ? input.url : String(input)).pathname.includes('/model/')
    ) {
      blocked = true;
      started();
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }
    return Promise.resolve(unavailable(input));
  });
  const verify = jest.spyOn(InferenceClient.prototype, 'verify');
  const own = credentials('in-flight-refresh-test');
  const pending = verifyNearAIModel(own, model);
  await firstRequest;
  await verifyNearAIModelReports(own, model, { refresh: true });
  const current = await verifyNearAIModel(own, model);
  release(new Response('{}', { status: 200 }));
  expect(await pending).toMatchObject({ status: 'failed', errorCode: current.errorCode });
  expect(current.errorCode).toBe('api.http_status');
  expect(verify.mock.contexts).toHaveLength(3);
  expect(verify.mock.contexts[1]).not.toBe(verify.mock.contexts[0]);
  expect(verify.mock.contexts[2]).toBe(verify.mock.contexts[1]);
});

it.each(['reports', 'reports with replacement', 'status'])(
  'rechecks failed metadata after a %s refresh',
  async (refresh) => {
    let release!: (response: Response) => void;
    let metadataRequests = 0;
    const metadata = new Promise<Response>((resolve) => {
      release = resolve;
    });
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
      if (path.includes('/model/') && ++metadataRequests === 1) return metadata;
      return unavailable(input);
    });
    const own = credentials(`metadata-refresh-${refresh}`);
    const pending = verifyNearAIModel(own, model);
    if (refresh === 'status') {
      await verifyNearAIModel(own, model, true);
    } else {
      await verifyNearAIModelReports(own, model, { scope: 'gateway', refresh: true });
      if (refresh === 'reports with replacement') await verifyNearAIModel(own, model);
    }
    release(Response.json({ metadata: {} }));
    expect(await pending).toMatchObject({ status: 'failed', errorCode: 'api.http_status' });
    expect(metadataRequests).toBe(2);
  },
);

it('returns a genuine metadata failure without retrying and lets the next request retry', async () => {
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => Response.json({ metadata: {} }));
  const own = credentials('invalid-metadata');
  for (const calls of [1, 2]) {
    const status = await verifyNearAIModel(own, model);
    expect(status).toMatchObject({ status: 'failed', errorCode: 'api.invalid_response' });
    expect(status).not.toHaveProperty('message');
    expect(fetch).toHaveBeenCalledTimes(calls);
  }
});

it('does not retry an invalidated session after the caller aborts', async () => {
  let release!: (response: Response) => void;
  let metadataRequests = 0;
  const metadata = new Promise<Response>((resolve) => {
    release = resolve;
  });
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    if (path.includes('/model/')) {
      metadataRequests++;
      return metadata;
    }
    return unavailable(input);
  });
  const own = credentials('metadata-refresh-aborted');
  const controller = new AbortController();
  const pending = verifyNearAIModel(own, model, false, controller.signal);
  await verifyNearAIModelReports(own, model, { scope: 'gateway', refresh: true });
  controller.abort(new DOMException('Timed out', 'TimeoutError'));
  expect(await pending).toMatchObject({
    status: 'failed',
    errorCode: 'nearai_verification_timeout',
  });
  release(Response.json({ metadata: {} }));
  expect(metadataRequests).toBe(1);
});

it('discards a timed-out metadata lookup so the next verification can retry', async () => {
  let stalled = true;
  jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input) =>
      stalled ? new Promise(() => {}) : Promise.resolve(unavailable(input)),
    );
  const own = credentials('metadata-timeout-retry');
  expect(await verifyNearAIModel(own, model, false, AbortSignal.timeout(10))).toMatchObject({
    status: 'failed',
    errorCode: 'nearai_verification_timeout',
  });
  stalled = false;
  expect(await verifyNearAIModel(own, model)).toMatchObject({
    status: 'failed',
    errorCode: 'api.http_status',
  });
});

it('retains the verified client across TTL expiry without limiting a slow completion', async () => {
  let now = Date.now();
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  let metadataRequests = 0;
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    if (path.includes('/model/')) {
      metadataRequests++;
      return Response.json({ metadata: { providerType: 'external', attestationSupported: false } });
    }
    return new Promise(() => {});
  });
  const verifiedClients: InferenceClient[] = [];
  let advance = false;
  const verify = jest.spyOn(InferenceClient.prototype, 'verify').mockImplementation(async function (
    this: InferenceClient,
  ) {
    verifiedClients.push(this);
    if (advance) now += 2;
  });
  const own = { ...credentials('expiry-between-preflight-and-fetch'), verificationTimeoutMs: 1000 };
  expect(await verifyNearAIModel(own, model)).not.toHaveProperty('client');
  const first = verifiedClients[0];
  const caller = new AbortController();
  const completion = jest.spyOn(first, 'fetch').mockImplementation(async (_input, init) => {
    expect(init?.signal).toBe(caller.signal);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    return Response.json({ id: 'chatcmpl-slow' });
  });
  now += 60 * 60 * 1000 - 1;
  advance = true;
  const pending = createNearAIFetch(own)(`${own.baseURL}/chat/completions`, {
    method: 'POST',
    body: JSON.stringify({ model, messages: [] }),
    signal: caller.signal,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      pending,
      new Promise<'pending'>((resolve) => {
        timer = setTimeout(() => resolve('pending'), 2000);
      }),
    ]);
    expect(metadataRequests).toBe(1);
    expect(completion).toHaveBeenCalledTimes(1);
    expect(response).not.toBe('pending');
    if (response === 'pending') throw new Error('Chat escaped the verification deadline');
    expect(response.status).toBe(200);
    await verifyNearAIModel(own, model);
    expect(metadataRequests).toBe(2);
    expect(verify.mock.contexts[2]).not.toBe(first);
  } finally {
    clearTimeout(timer);
    caller.abort();
    await pending.catch(() => undefined);
  }
});

it('blocks Chat within the verification deadline when hardware verification stalls', async () => {
  const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    return path.includes('/model/')
      ? Response.json({ metadata: { providerType: 'external', attestationSupported: false } })
      : new Promise(() => {});
  });
  const own = { ...credentials('verification-stalled-before-chat'), verificationTimeoutMs: 20 };
  const response = await createNearAIFetch(own)(`${own.baseURL}/chat/completions`, {
    method: 'POST',
    body: JSON.stringify({ model, messages: [] }),
  });
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: 'nearai_verification_timeout' } });
  expect(fetch.mock.calls.some(([input]) => String(input).includes('/chat/completions'))).toBe(
    false,
  );
});
