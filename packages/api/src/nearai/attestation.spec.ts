import express from 'express';
import request from 'supertest';
import { FileSources } from 'librechat-data-provider';
import { InferenceClient } from '@nearai/inference-sdk/node';
import type { AppConfig } from '@librechat/data-schemas';
import { isNearAIBaseURL, getNearAICredentials, verifyNearAIModel } from './attestation';
import { nearAIAttestationHandler } from './handler';

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
  it('does not enable verification for a third-party endpoint named NEAR AI', () => {
    expect(
      getNearAICredentials(config('NEAR AI', 'https://api.openai.com/v1'), 'NEAR AI'),
    ).toBeUndefined();
  });

  it('identifies NEAR AI by its API host even when the endpoint has a different display name', () => {
    const baseURL = 'https://cloud-stg-api.near.ai/v1';
    expect(getNearAICredentials(config('Private chat', baseURL), 'Private chat')).toEqual({
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
