import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels, createMethods } from '@librechat/data-schemas';
import type { NearAIReceipt } from './receipts';
import {
  createNearAIReceiptCollector,
  runWithNearAIReceipts,
  getNearAIReceiptCollector,
} from './receipts';
import { createReplyReport } from './report';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  createModels(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

it('collects report snapshots and restores them through the real message database methods', async () => {
  const receipt: NearAIReceipt = {
    completionId: 'completion-1',
    model: 'z-ai/glm-5.3-flash',
    status: 'failed',
    verifiedAt: '2026-10-27T10:00:00.000Z',
    errorCode: 'api.completion_not_found',
    report: {
      schemaVersion: 1,
      kind: 'reply',
      scope: 'unknown',
      status: 'unverifiable',
      completionId: 'completion-1',
      model: 'z-ai/glm-5.3-flash',
      verifiedAt: '2026-10-27T10:00:00.000Z',
      error: { code: 'api.completion_not_found', message: 'Verification context unavailable.' },
    },
  };
  const collector = createNearAIReceiptCollector();
  await runWithNearAIReceipts(collector, async () => {
    expect(getNearAIReceiptCollector()).toBe(collector);
    collector.add(Promise.resolve(receipt));
  });
  const receipts = await collector.settle();
  expect(receipts).toEqual([receipt]);
  expect(getNearAIReceiptCollector()).toBeUndefined();
  const methods = createMethods(mongoose);
  const userId = new mongoose.Types.ObjectId().toString();
  const conversationId = randomUUID();
  await methods.saveMessage(
    { userId },
    {
      messageId: randomUUID(),
      parentMessageId: randomUUID(),
      conversationId,
      text: 'Response with saved verification metadata',
      isCreatedByUser: false,
      metadata: { nearai: { receipts } },
    },
  );
  const messages = await methods.getMessages({ conversationId, user: userId });
  expect(messages).toHaveLength(1);
  expect(messages[0].metadata?.nearai).toEqual({ receipts: [receipt] });
});

it('keeps Gateway-only reports valid after a real MongoDB round trip', async () => {
  const signer = { signingAlgo: 'ecdsa' as const, signingAddress: '0x' + '1'.repeat(40) };
  const result = createReplyReport(
    {
      completionId: 'gateway-completion',
      signatureKind: 'gateway',
      signature: {
        kind: 'gateway',
        signer,
        signedText: '2'.repeat(64) + ':' + '3'.repeat(64),
        signature: '4'.repeat(130),
      },
      attestation: {
        signer,
        tcbStatus: 'UpToDate',
        advisoryIds: [],
        deploymentProvenance: 'not_checked',
        deployment: { appCompose: 'PRIVATE CONFIG', runtimeMeasurements: {} },
        tlsBinding: { kind: 'attested', spkiFingerprint: '5'.repeat(64) },
      },
    },
    new Date().toISOString(),
  );
  if (!result.ok) throw new Error('Expected a Gateway report');
  const userId = new mongoose.Types.ObjectId().toString();
  const methods = createMethods(mongoose);
  const conversationId = randomUUID();
  await methods.saveMessage(
    { userId },
    {
      messageId: randomUUID(),
      parentMessageId: randomUUID(),
      conversationId,
      text: 'Gateway reply',
      isCreatedByUser: false,
      metadata: { nearai: { receipts: [{ report: result.value }] } },
    },
  );
  const [saved] = await methods.getMessages({ conversationId, user: userId });
  expect(saved.metadata?.nearai).toEqual({ receipts: [{ report: result.value }] });
  expect(JSON.stringify(saved.metadata?.nearai)).not.toContain('null');
  expect(JSON.stringify(saved.metadata?.nearai)).not.toContain('PRIVATE');
});
