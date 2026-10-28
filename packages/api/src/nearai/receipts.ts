import { AsyncLocalStorage } from 'node:async_hooks';
import type { TNearAIReceipt } from 'librechat-data-provider';

/** Signature verification result for one NEAR AI completion, stored on the reply's metadata. */
export type NearAIReceipt = TNearAIReceipt;

/** Collects the receipts of every NEAR AI completion made while producing one reply. */
export interface NearAIReceiptCollector {
  add(receipt: Promise<NearAIReceipt>): void;
  /** Waits for pending verifications, bounded so a slow signature lookup cannot hold the reply. */
  settle(timeoutMs?: number): Promise<NearAIReceipt[]>;
}

const storage = new AsyncLocalStorage<NearAIReceiptCollector>();

const SETTLE_TIMEOUT_MS = 15_000;

export function createNearAIReceiptCollector(): NearAIReceiptCollector {
  const pending: Promise<NearAIReceipt | undefined>[] = [];
  return {
    add(receipt) {
      pending.push(receipt.catch(() => undefined));
    },
    async settle(timeoutMs = SETTLE_TIMEOUT_MS) {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs);
      });
      const results = await Promise.race([Promise.all(pending), timeout]);
      clearTimeout(timer);
      if (results === 'timeout') {
        return [];
      }
      return results.filter((receipt): receipt is NearAIReceipt => receipt != null);
    },
  };
}

/** Runs `fn` with `collector` receiving receipts from NEAR AI completions made inside it. */
export function runWithNearAIReceipts<T>(
  collector: NearAIReceiptCollector,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(collector, fn);
}

export function getNearAIReceiptCollector(): NearAIReceiptCollector | undefined {
  return storage.getStore();
}

const ID_SCAN_LIMIT = 64 * 1024;

/**
 * Passes a completion body through unchanged, reading its top-level `id` (the first one
 * in JSON or SSE output) and calling `onComplete` once the body has been fully read.
 */
export function observeCompletionBody(
  response: Response,
  onComplete: (completionId: string) => void,
): Response {
  if (!response.body) {
    return response;
  }
  const decoder = new TextDecoder();
  let scanned = '';
  let completionId: string | undefined;
  const observer = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (completionId == null && scanned.length < ID_SCAN_LIMIT) {
        scanned += decoder.decode(chunk, { stream: true });
        completionId = /"id"\s*:\s*"([^"]+)"/.exec(scanned)?.[1];
      }
      controller.enqueue(chunk);
    },
    flush() {
      if (completionId) {
        onComplete(completionId);
      }
    },
  });
  return new Response(response.body.pipeThrough(observer), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
