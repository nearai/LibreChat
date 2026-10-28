import { FileSources } from 'librechat-data-provider';
import { Providers, initializeModel } from '@librechat/agents';
import type { OpenAIClientOptions } from '@librechat/agents';
import type { AppConfig } from '@librechat/data-schemas';
import type { BaseInitializeParams, OpenAIConfiguration } from '~/types';
import { initializeCustom } from '~/endpoints/custom/initialize';

const cases = [
  ['https://cloud-api.near.ai/v1', 'openai/gpt-4.1-mini', false],
  ['https://cloud-stg-api.near.ai/v1', 'openai/gpt-4.1-mini', false],
  ['https://api.openai.com/v1', 'openai/gpt-4.1-mini', true],
  ['https://cloud-api.near.ai/v1', 'Qwen/Qwen3.6-35B-A3B-FP8', true],
  ['https://cloud-api.near.ai/v1', 'deepseek/deepseek-v3.2', true],
] as const;

it.each(
  cases.flatMap(([baseURL, model, keepUser]) =>
    [false, true].map((streaming) => ({ baseURL, model, keepUser, streaming })),
  ),
)(
  'handles user for $baseURL / $model (streaming: $streaming)',
  async ({ baseURL, model, keepUser, streaming }) => {
    const config: AppConfig = {
      config: {},
      fileStrategy: FileSources.local,
      imageOutputType: 'png',
      endpoints: {
        custom: [
          {
            name: 'NEAR AI',
            apiKey: 'test-key',
            baseURL,
            models: { default: [model] },
            tokenConfig: { [model]: { context: 8192, prompt: 0, completion: 0 } },
            addParams: { user: 'configured-user', seed: 42 },
            dropParams: ['seed'],
          },
        ],
      },
    };
    const options = await initializeCustom({
      endpoint: 'NEAR AI',
      req: { config, body: {}, user: { id: 'user-1' } } as BaseInitializeParams['req'],
      db: {} as BaseInitializeParams['db'],
      model_parameters: { model },
    });
    expect(config.endpoints?.custom?.[0].dropParams).toEqual(['seed']);
    const bodies: Record<string, unknown>[] = [];
    const fetch: NonNullable<NonNullable<OpenAIConfiguration>['fetch']> = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      if (streaming) {
        const chunk = {
          id: 'chatcmpl-params',
          object: 'chat.completion.chunk',
          model,
          choices: [
            { index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' },
          ],
        };
        return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      return Response.json({
        id: 'chatcmpl-params',
        object: 'chat.completion',
        model,
        choices: [
          { index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    };
    const chat = initializeModel({
      provider: Providers.OPENAI,
      clientOptions: {
        ...(options.llmConfig as OpenAIClientOptions),
        streaming,
        configuration: { ...options.configOptions, fetch },
      },
      tools: [],
    });
    const reply = await chat.invoke('Reply OK.');
    expect(reply.content).toBe('OK');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ model, stream: streaming });
    expect(Object.prototype.hasOwnProperty.call(bodies[0], 'user')).toBe(keepUser);
    expect(bodies[0]).not.toHaveProperty('seed');
  },
);
