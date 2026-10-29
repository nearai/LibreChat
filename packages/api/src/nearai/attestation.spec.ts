import express from 'express';
import request from 'supertest';
import { FileSources } from 'librechat-data-provider';
import { InferenceClient } from '@nearai/inference-sdk/node';
import type { AppConfig } from '@librechat/data-schemas';
import type { GetUserKeyValuesFunction } from '~/types';
import { isNearAIBaseURL, getNearAICredentials, verifyNearAIModel } from './attestation';
import { nearAIAttestationHandler, getNearAIVerificationConfig } from './handler';

function config(name: string, baseURL: string): AppConfig {
  return {
    config: {},
    fileStrategy: FileSources.local,
    imageOutputType: 'png',
    endpoints: {
      custom: [{ name, baseURL, apiKey: 'test-key', models: { default: ['test-model'] } }],
    },
  };
}

describe('NEAR AI endpoint detection', () => {
  it('lists configured NEAR AI endpoints by host for the startup shield', () => {
    process.env.NEARAI_TEST_URL = 'https://cloud-api.near.ai/v1';
    const appConfig = config('Private', '${NEARAI_TEST_URL}');
    appConfig.endpoints!.custom!.push(
      {
        name: 'OpenAI',
        baseURL: 'https://api.openai.com/v1',
        apiKey: 'k',
        models: { default: ['m'] },
      },
      { name: 'Own', baseURL: 'user_provided', apiKey: 'k', models: { default: ['m'] } },
      {
        name: 'Keyed',
        baseURL: 'https://cloud-api.near.ai/v1',
        apiKey: 'user_provided',
        models: { default: ['m'] },
      },
    );
    expect(getNearAIVerificationConfig(undefined, appConfig).nearaiEndpoints).toEqual([
      'Private',
      'Keyed',
    ]);
    expect(getNearAIVerificationConfig(undefined).nearaiEndpoints).toEqual([]);
    delete process.env.NEARAI_TEST_URL;
  });

  it('does not enable verification for a third-party endpoint named NEAR AI', async () => {
    await expect(
      getNearAICredentials(config('NEAR AI', 'https://api.openai.com/v1'), 'NEAR AI'),
    ).resolves.toBeUndefined();
  });

  it('identifies NEAR AI by its API host even when the endpoint has a different display name', async () => {
    const baseURL = 'https://cloud-stg-api.near.ai/v1';
    await expect(
      getNearAICredentials(config('Private chat', baseURL), 'Private chat'),
    ).resolves.toEqual({
      apiKey: 'test-key',
      baseURL,
    });
  });

  it.each(['cloud-api.near.ai', 'cloud-stg-api.near.ai'])(
    'enables SDK verification for %s',
    (host) => {
      expect(isNearAIBaseURL(`https://${host}/v1`)).toBe(true);
    },
  );

  it.each([null, undefined, 'invalid', 'https://cloud-stg-api.near.ai.example.com/v1'])(
    'does not treat %s as a NEAR AI endpoint',
    (url) => {
      expect(isNearAIBaseURL(url)).toBe(false);
    },
  );
});

describe('attestation reports endpoint', () => {
  function app(baseURL: string, timeoutMs?: number) {
    const server = express();
    server.get('/attestation', async (req, res) => {
      const appConfig = config('NEAR AI', baseURL);
      if (timeoutMs) appConfig.config.nearai = { verificationTimeoutMs: timeoutMs };
      await nearAIAttestationHandler({ query: req.query, config: appConfig }, res);
    });
    return server;
  }

  it.each([false, true])('resets Chat only when refresh=%s is requested', async (refresh) => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        new URL(input instanceof Request ? input.url : String(input)).pathname.includes('/model/')
          ? Response.json({ metadata: { providerType: 'vllm', attestationSupported: true } })
          : new Response('{}', { status: 503 }),
      );
    const verify = jest.spyOn(InferenceClient.prototype, 'verify');
    const baseURL = 'http://cloud-stg-api.near.ai/v1';
    const credentials = { apiKey: 'test-key', baseURL };
    await verifyNearAIModel(credentials, 'test-model');
    const original = verify.mock.contexts[0];
    const res = await request(app(baseURL))
      .get('/attestation')
      .query({
        endpoint: 'NEAR AI',
        model: 'test-model',
        reports: '1',
        scope: 'gateway',
        ...(refresh ? { refresh: '1' } : {}),
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      enabled: true,
      status: 'failed',
      reports: [{ kind: 'model', scope: 'gateway', status: 'unverifiable' }],
    });
    expect(res.body).not.toHaveProperty('verifyUrl');
    await verifyNearAIModel(credentials, 'test-model');
    if (refresh) expect(verify.mock.contexts[1]).not.toBe(original);
    else expect(verify.mock.contexts[1]).toBe(original);
  });

  it('does not fetch reports for a third-party endpoint named NEAR AI', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch');
    const res = await request(app('https://api.openai.com/v1'))
      .get('/attestation')
      .query({ endpoint: 'NEAR AI', model: 'test-model', reports: '1', refresh: '1' });
    expect(res.body).toEqual({ enabled: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('user-provided NEAR AI credentials', () => {
  // HTTP uses the SDK's fetch transport, allowing the external request to be intercepted.
  const baseURL = 'http://cloud-stg-api.near.ai/v1';
  const endpoint = 'NEAR AI';
  const query = { endpoint, model: 'test-model', reports: '1', scope: 'gateway' };

  function app(
    getUserKeyValues: GetUserKeyValuesFunction,
    userId?: string,
    configuredURL = baseURL,
  ) {
    const server = express();
    const appConfig = config(endpoint, configuredURL);
    appConfig.endpoints!.custom![0].apiKey = 'user_provided';
    server.get('/attestation', async (req, res) => {
      await nearAIAttestationHandler(
        { query: req.query, config: appConfig, ...(userId ? { user: { id: userId } } : {}) },
        res,
        getUserKeyValues,
      );
    });
    return server;
  }

  it('uses only the authenticated user and configured host, including after replacing the key', async () => {
    const keys = new Map([
      ['user-a', 'key-a'],
      ['user-b', 'key-b'],
    ]);
    const reads: { userId: string; name: string }[] = [];
    const getUserKeyValues: GetUserKeyValuesFunction = async (params) => {
      reads.push(params);
      return { apiKey: keys.get(params.userId), baseURL: 'https://untrusted.example/v1' };
    };
    const authorizations: (string | null)[] = [];
    const urls: string[] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      urls.push(input instanceof Request ? input.url : String(input));
      const headers = input instanceof Request ? input.headers : new Headers(init?.headers);
      authorizations.push(headers.get('authorization'));
      return new Response('{}', { status: 503 });
    });
    for (const userId of ['user-a', 'user-b', 'user-a']) {
      if (reads.length === 2) keys.set('user-a', 'replacement-key-a');
      const response = await request(app(getUserKeyValues, userId))
        .get('/attestation')
        .query({ ...query, userId: 'other-user' });
      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(true);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(JSON.stringify(response.body)).not.toContain(keys.get(userId));
    }
    expect(reads).toEqual([
      { userId: 'user-a', name: endpoint },
      { userId: 'user-b', name: endpoint },
      { userId: 'user-a', name: endpoint },
    ]);
    expect(authorizations).toEqual(['Bearer key-a', 'Bearer key-b', 'Bearer replacement-key-a']);
    expect(urls.every((url) => new URL(url).origin === new URL(baseURL).origin)).toBe(true);
  });

  it.each(['user_provided', 'https://other.example/v1'])(
    'does not read user credentials for an unsupported URL: %s',
    async (url) => {
      const reads: string[] = [];
      const response = await request(
        app(
          async ({ userId }) => {
            reads.push(userId);
            return { apiKey: 'secret' };
          },
          'user-a',
          url,
        ),
      )
        .get('/attestation')
        .query(query);
      expect(response.body).toEqual({ enabled: false });
      expect(reads).toHaveLength(0);
    },
  );

  it.each([401, 403])(
    'does not report success or disclose a rejected key (HTTP %s)',
    async (status) => {
      jest
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () =>
          Response.json({ error: { message: 'Rejected secret-key-value' } }, { status }),
        );
      const response = await request(app(async () => ({ apiKey: 'secret-key-value' }), 'user-a'))
        .get('/attestation')
        .query(query);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        enabled: true,
        status: 'failed',
        reports: [{ status: 'unverifiable', error: { code: 'api.http_status' } }],
      });
      expect(JSON.stringify(response.body)).not.toContain('secret-key-value');
    },
  );

  it('does not resolve credentials from a supplied user ID without an authenticated user', async () => {
    const reads: string[] = [];
    const response = await request(
      app(async ({ userId }) => {
        reads.push(userId);
        return { apiKey: 'secret' };
      }),
    )
      .get('/attestation')
      .query({ ...query, userId: 'user-a' });
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: { code: 'nearai_credentials_unavailable' } });
    expect(reads).toHaveLength(0);
  });

  it('returns a safe error for a missing key or storage failure and allows a later request to retry', async () => {
    let attempts = 0;
    const server = app(async () => {
      attempts++;
      if (attempts === 1) throw new Error('storage failure containing secret-key-value');
      return attempts === 2 ? {} : { apiKey: 'saved-key' };
    }, 'user-a');
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 503 }));
    for (let index = 0; index < 2; index++) {
      const response = await request(server).get('/attestation').query(query);
      expect(response.status).toBe(503);
      expect(response.body).toEqual({ error: { code: 'nearai_credentials_unavailable' } });
    }
    const response = await request(server).get('/attestation').query(query);
    expect(response.status).toBe(200);
    expect(response.body.enabled).toBe(true);
    expect(attempts).toBe(3);
  });

  it('does not read user keys for a server-managed credential', async () => {
    const reads: string[] = [];
    await expect(
      getNearAICredentials(config(endpoint, baseURL), endpoint, {
        userId: 'user-a',
        getUserKeyValues: async ({ userId }) => {
          reads.push(userId);
          return { apiKey: 'user-key' };
        },
      }),
    ).resolves.toMatchObject({ apiKey: 'test-key', baseURL });
    expect(reads).toHaveLength(0);
  });
});

it.each([false, true])(
  'returns a safe timeout result for stalled requests (reports: %s)',
  async (reports) => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
    const app = express();
    app.get('/attestation', async (req, res) => {
      const appConfig = config('NEAR AI', 'http://cloud-stg-api.near.ai/v1');
      appConfig.config.nearai = { verificationTimeoutMs: 1000 };
      await nearAIAttestationHandler({ query: req.query, config: appConfig }, res);
    });
    const res = await request(app)
      .get('/attestation')
      .query({ endpoint: 'NEAR AI', model: 'stalled-model', ...(reports ? { reports: '1' } : {}) });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: true, status: 'failed' });
    if (reports)
      expect(res.body.reports).toEqual([
        expect.objectContaining({
          status: 'unverifiable',
          error: expect.objectContaining({ code: 'nearai_verification_timeout' }),
        }),
      ]);
    else expect(res.body.errorCode).toBe('nearai_verification_timeout');
    expect(res.body).not.toHaveProperty('message');
  },
);
