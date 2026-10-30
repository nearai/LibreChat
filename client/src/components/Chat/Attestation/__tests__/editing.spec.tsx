import React, { useState } from 'react';
import axios from 'axios';
import { RecoilRoot } from 'recoil';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@librechat/client';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Constants, ContentTypes, QueryKeys, tConversationSchema } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import type { MessagesOperations, MessagesViewContextValue } from '~/Providers/MessagesViewContext';
import { MessagesOperationsContext, MessagesViewContext } from '~/Providers/MessagesViewContext';
import EditContentParts from '~/components/Chat/Messages/Content/EditContentParts';
import { useGetMessagesByConvoId } from '~/data-provider/Messages/queries';
import EditMessage from '~/components/Chat/Messages/Content/EditMessage';
import { useEditArtifact } from '~/data-provider/Messages/mutations';
import { receipt } from 'test/fixtures/nearai';
import Signature from '../Signature';

jest.mock('~/hooks', () => ({
  useLocalize: jest.requireActual('~/hooks/useLocalize').default,
}));

const conversationId = 'edited-conversation';
const queryKey = [QueryKeys.messages, conversationId];
type Editor = 'text' | 'content' | 'artifact';
const artifactLabel = 'Save artifact';

function Thread({ client, editor }: { client: QueryClient; editor: Editor }) {
  const { data: messages } = useGetMessagesByConvoId(conversationId);
  const artifact = useEditArtifact();
  const [editing, setEditing] = useState(true);
  const message = messages![0];
  const operations: MessagesOperations = {
    ask: () => undefined,
    regenerate: () => undefined,
    handleContinue: () => undefined,
    getMessages: () => client.getQueryData<TMessage[]>(queryKey),
    setMessages: (updated) => client.setQueryData(queryKey, updated),
  };
  const view: MessagesViewContextValue = {
    ...operations,
    conversation: tConversationSchema.parse({
      conversationId,
      model: receipt.model,
      endpoint: 'custom',
      createdAt: receipt.verifiedAt,
      updatedAt: receipt.verifiedAt,
    }),
    conversationId,
    readOnly: false,
    isSubmitting: false,
    abortScroll: false,
    setAbortScroll: () => undefined,
    index: 0,
    latestMessageId: message.messageId,
    latestMessageDepth: 0,
  };
  return (
    <MessagesViewContext.Provider value={view}>
      <MessagesOperationsContext.Provider value={operations}>
        <Signature message={message} isLast={true} />
        {editing && editor === 'text' && (
          <EditMessage
            text={message.text}
            message={message}
            isSubmitting={false}
            ask={operations.ask}
            enterEdit={() => setEditing(false)}
            siblingIdx={0}
            setSiblingIdx={() => undefined}
          />
        )}
        {editing && editor === 'content' && (
          <EditContentParts
            content={message.content!}
            messageId={message.messageId}
            isSubmitting={false}
            enterEdit={() => setEditing(false)}
            siblingIdx={0}
            setSiblingIdx={() => undefined}
            renderReadOnlyPart={() => null}
          />
        )}
        {editor === 'artifact' && (
          <button
            onClick={() =>
              artifact.mutate({
                messageId: message.messageId,
                index: 0,
                original: 'Original',
                updated: 'Edited',
              })
            }
          >
            {artifactLabel}
          </button>
        )}
      </MessagesOperationsContext.Provider>
    </MessagesViewContext.Provider>
  );
}

function setup(editor: Editor) {
  const message: TMessage = {
    messageId: 'verified-reply',
    conversationId,
    parentMessageId: String(Constants.NO_PARENT),
    text: 'Original',
    sender: 'NEAR AI',
    isCreatedByUser: false,
    metadata: { nearai: { receipts: [receipt] }, kept: 'other metadata' },
    ...(editor === 'content' ? { content: [{ type: ContentTypes.TEXT, text: 'Original' }] } : {}),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKey, [message]);
  let finishRead!: () => void;
  jest.spyOn(axios, 'get').mockImplementation(
    () =>
      new Promise((resolve) => {
        finishRead = () => resolve({ data: [{ ...message, userSubmittedPaths: ['/text'] }] });
      }),
  );
  jest
    .spyOn(axios, 'put')
    .mockResolvedValue({ data: { ...message, userSubmittedPaths: ['/text'] } });
  jest.spyOn(axios, 'post').mockResolvedValue({ data: { conversationId, text: 'Edited' } });
  const rendered = render(
    <QueryClientProvider client={client}>
      <RecoilRoot>
        <ThemeProvider initialTheme="light">
          <MemoryRouter initialEntries={[`/c/${conversationId}`]}>
            <Thread client={client} editor={editor} />
          </MemoryRouter>
        </ThemeProvider>
      </RecoilRoot>
    </QueryClientProvider>,
  );
  return {
    client,
    message,
    rendered,
    finishRead: () => finishRead(),
  };
}

it.each<Editor>(['text', 'content', 'artifact'])(
  'clears old reports immediately after a successful %s edit, before history reload',
  async (editor) => {
    const { client, finishRead, rendered } = setup(editor);
    expect(screen.getByTestId('nearai-signature-button')).toBeInTheDocument();
    if (editor === 'artifact') {
      fireEvent.click(screen.getByRole('button', { name: 'Save artifact' }));
    } else {
      const user = userEvent.setup();
      await user.clear(screen.getByRole('textbox'));
      await user.type(screen.getByRole('textbox'), 'Edited');
      await user.click(screen.getByRole('button', { name: 'Save' }));
    }
    await waitFor(() =>
      expect(screen.queryByTestId('nearai-signature-button')).not.toBeInTheDocument(),
    );
    expect(client.getQueryData<TMessage[]>(queryKey)![0].metadata).toEqual({
      kept: 'other metadata',
    });
    if (editor !== 'artifact') {
      expect(axios.get).toHaveBeenCalled();
      await act(async () => finishRead());
      await waitFor(() => expect(client.isFetching({ queryKey })).toBe(0));
      expect(screen.queryByTestId('nearai-signature-button')).not.toBeInTheDocument();
    }
    rendered.unmount();
    client.clear();
  },
);

it.each<Editor>(['text', 'content'])(
  'preserves the original report when a %s edit fails',
  async (editor) => {
    const { client, rendered } = setup(editor);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.mocked(axios.put).mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'Edited');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('alert');
    expect(screen.getByTestId('nearai-signature-button')).toBeInTheDocument();
    expect(client.getQueryData<TMessage[]>(queryKey)![0].text).toBe('Original');
    rendered.unmount();
    client.clear();
  },
);
