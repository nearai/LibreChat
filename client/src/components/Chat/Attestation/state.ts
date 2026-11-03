import { useCallback } from 'react';
import { atom } from 'jotai';
import { QueryKeys } from 'librechat-data-provider';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TMessage } from 'librechat-data-provider';
import { latestModelKey } from './proof';

/** Bumped by a reply's "Show in header"; the header proof button rings on each change. */
export const proofPulseAtom = atom(0);

/**
 * The model key behind this conversation's latest signed reply for `model`. Reads the
 * cached messages without fetching them; the selected key is a string, so streaming
 * deltas that leave it unchanged do not re-render the caller.
 */
export function useLatestModelKey(
  conversationId: string | null | undefined,
  model: string,
): string | undefined {
  const queryClient = useQueryClient();
  const queryKey = [QueryKeys.messages, conversationId ?? ''];
  const select = useCallback(
    (messages: TMessage[]) => latestModelKey(messages, model) ?? null,
    [model],
  );
  const { data } = useQuery<TMessage[], unknown, string | null>(
    queryKey,
    async () => queryClient.getQueryData<TMessage[]>(queryKey) ?? [],
    { enabled: false, select },
  );
  return conversationId ? (data ?? undefined) : undefined;
}
