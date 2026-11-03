import React from 'react';
import { RecoilRoot } from 'recoil';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TMessage, TNearAIAttestationResponse } from 'librechat-data-provider';
import Shield from '../Shield';

const KEY = '5a0210f2442c79355784f9de021985429561da5bacc3a4424b01ac52b7e0caff';
const MODEL = 'z-ai/glm-5.3-flash';

/** The HTTP boundary: a plain copy of `dataService` so its request can be spied on. */
jest.mock('librechat-data-provider', () => {
  const actual =
    jest.requireActual<typeof import('librechat-data-provider')>('librechat-data-provider');
  return { ...actual, dataService: { ...actual.dataService } };
});

const mockChat = {
  conversation: { conversationId: 'c-1', endpoint: 'NEAR AI', model: MODEL },
};

jest.mock('~/Providers', () => ({
  useChatContext: () => mockChat,
}));

const verified: TNearAIAttestationResponse = {
  enabled: true,
  model: MODEL,
  status: 'verified',
  checkedAt: new Date().toISOString(),
  verifyUrl: 'https://cloud.near.ai/verify',
};

function renderShield(messages?: TMessage[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (messages) {
    client.setQueryData([QueryKeys.messages, 'c-1'], messages);
  }
  return render(<Shield />, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>
        <RecoilRoot>{children}</RecoilRoot>
      </QueryClientProvider>
    ),
  });
}

/** `restoreMocks` undoes spies after each test, so each test installs its own. */
let getAttestation: jest.SpiedFunction<typeof dataService.getNearAIAttestation>;
beforeEach(() => {
  getAttestation = jest.spyOn(dataService, 'getNearAIAttestation');
});

describe('Shield', () => {
  it('checks, then shows the verified model with its four checks', async () => {
    let resolve: (value: TNearAIAttestationResponse) => void = () => undefined;
    getAttestation.mockReturnValueOnce(new Promise((done) => (resolve = done)));
    renderShield();

    expect(await screen.findByRole('button', { name: 'NEAR AI proof: Checking' })).toBeVisible();

    resolve(verified);
    const pill = await screen.findByRole('button', { name: 'NEAR AI proof: Verified' });
    fireEvent.click(pill);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Model verified')).toBeInTheDocument();
    for (const check of ['NEAR AI Gateway', 'CPU enclave · Intel TDX', 'GPU · NVIDIA']) {
      expect(within(dialog).getByText(check)).toBeInTheDocument();
    }
    expect(
      within(dialog).getByText('The seal appears once the model signs a reply.'),
    ).toBeVisible();
    expect(within(dialog).getByRole('link', { name: /Open full report/ })).toHaveAttribute(
      'href',
      `https://cloud.near.ai/verify?model=${encodeURIComponent(MODEL)}`,
    );
  });

  it('prints the seal of the key that signed this chat', async () => {
    getAttestation.mockResolvedValueOnce(verified);
    renderShield([
      {
        messageId: 'm-1',
        conversationId: 'c-1',
        parentMessageId: null,
        isCreatedByUser: false,
        text: 'hi',
        metadata: {
          nearai: {
            receipts: [
              {
                completionId: 'chatcmpl-1',
                model: MODEL,
                status: 'verified' as const,
                verifiedAt: new Date().toISOString(),
                signatureKind: 'provider_tee' as const,
                signingAddress: KEY,
              },
            ],
          },
        },
      } as TMessage,
    ]);

    fireEvent.click(
      await screen.findByRole('button', { name: 'NEAR AI proof: Verified, seal 5A02·CAFF' }),
    );
    expect(await screen.findByText('Seal 5A02·CAFF')).toBeVisible();
    expect(screen.getByText('Same seal on every signed reply')).toBeVisible();
  });

  it("draws the verified session's seal before the model signs a reply", async () => {
    getAttestation.mockResolvedValueOnce({
      ...verified,
      checks: { gateway: 'passed', cpu: 'passed', gpu: 'passed', key: 'passed' },
      signingKey: { signingAlgo: 'ed25519', signingAddress: KEY },
    });
    renderShield([]);

    fireEvent.click(
      await screen.findByRole('button', { name: 'NEAR AI proof: Verified, seal 5A02·CAFF' }),
    );
    expect(await screen.findByText('Seal 5A02·CAFF')).toBeVisible();
    expect(
      screen.queryByText('The seal appears once the model signs a reply.'),
    ).not.toBeInTheDocument();
  });

  it("prefers the session's key to an older reply's", async () => {
    const replyKey = 'ab'.repeat(32);
    getAttestation.mockResolvedValueOnce({
      ...verified,
      signingKey: { signingAlgo: 'ed25519', signingAddress: KEY },
    });
    renderShield([
      {
        messageId: 'm-1',
        conversationId: 'c-1',
        parentMessageId: null,
        isCreatedByUser: false,
        text: 'hi',
        metadata: {
          nearai: {
            receipts: [
              {
                completionId: 'chatcmpl-1',
                model: MODEL,
                status: 'verified' as const,
                verifiedAt: new Date().toISOString(),
                signatureKind: 'provider_tee' as const,
                signingAddress: replyKey,
              },
            ],
          },
        },
      } as TMessage,
    ]);

    expect(
      await screen.findByRole('button', { name: 'NEAR AI proof: Verified, seal 5A02·CAFF' }),
    ).toBeVisible();
  });

  it('flags a GPU check that had no evidence to examine', async () => {
    getAttestation.mockResolvedValueOnce({
      ...verified,
      checks: { gateway: 'passed', cpu: 'passed', gpu: 'not_provided', key: 'passed' },
    });
    renderShield();

    fireEvent.click(await screen.findByRole('button', { name: 'NEAR AI proof: Verified' }));
    const dialog = await screen.findByRole('dialog');
    const gpu = within(dialog).getByText('GPU · NVIDIA').closest('li') as HTMLElement;
    expect(within(gpu).getByText('No evidence was sent, so this is not proven')).toBeVisible();
    expect(within(gpu).getByText(': needs attention')).toBeInTheDocument();
    expect(within(dialog).getByText('Quote is valid and firmware is up to date')).toBeVisible();
  });

  it("fails the check the server names, whatever the code's area", async () => {
    getAttestation.mockResolvedValueOnce({
      ...verified,
      status: 'failed',
      errorCode: 'quote.verification_failed',
      checks: { gateway: 'failed', cpu: 'not_checked', gpu: 'not_checked', key: 'not_checked' },
    });
    renderShield();

    fireEvent.click(await screen.findByRole('button', { name: 'NEAR AI proof: Check failed' }));
    const dialog = await screen.findByRole('dialog');
    const gateway = within(dialog).getByText('NEAR AI Gateway').closest('li') as HTMLElement;
    expect(within(gateway).getByText('Did not pass: quote.verification_failed')).toBeVisible();
    expect(within(dialog).getAllByText('Not confirmed')).toHaveLength(3);
  });

  it('gives the code in the body when no single check can be blamed', async () => {
    getAttestation.mockResolvedValueOnce({
      ...verified,
      status: 'failed',
      errorCode: 'policy.tcb_status_not_allowed',
      checks: {
        gateway: 'not_checked',
        cpu: 'not_checked',
        gpu: 'not_checked',
        key: 'not_checked',
      },
    });
    renderShield();

    fireEvent.click(await screen.findByRole('button', { name: 'NEAR AI proof: Check failed' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/did not pass: policy\.tcb_status_not_allowed\./),
    ).toBeVisible();
    expect(within(dialog).getAllByText('Not confirmed')).toHaveLength(4);
    expect(within(dialog).queryByText(/^Did not pass:/)).not.toBeInTheDocument();
  });

  it('names the check a failure code points to on servers without per-check outcomes', async () => {
    getAttestation.mockResolvedValueOnce({
      ...verified,
      status: 'failed',
      errorCode: 'gpu.attestation_rejected',
    });
    renderShield();

    fireEvent.click(await screen.findByRole('button', { name: 'NEAR AI proof: Check failed' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Sending stays paused/)).toBeVisible();
    expect(within(dialog).getByText('Did not pass: gpu.attestation_rejected')).toBeVisible();
    expect(within(dialog).getAllByText('Not confirmed')).toHaveLength(3);
    expect(within(dialog).getByRole('link', { name: /See what failed/ })).toBeVisible();
  });

  it('says it could not check when the service is unreachable', async () => {
    getAttestation.mockRejectedValueOnce(new Error('network'));
    renderShield();

    fireEvent.click(await screen.findByRole('button', { name: 'NEAR AI proof: Not checked' }));
    expect(await screen.findByText("Couldn't check the model")).toBeVisible();
    expect(screen.queryByText('NEAR AI Gateway')).not.toBeInTheDocument();
  });

  it('checks again with a fresh request', async () => {
    getAttestation.mockResolvedValue(verified);
    renderShield();

    fireEvent.click(await screen.findByRole('button', { name: 'NEAR AI proof: Verified' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Check again' }));
    await waitFor(() =>
      expect(getAttestation).toHaveBeenCalledWith({
        endpoint: 'NEAR AI',
        model: MODEL,
        refresh: true,
      }),
    );
  });

  it('renders nothing for an endpoint outside NEAR AI', async () => {
    getAttestation.mockResolvedValueOnce({ enabled: false });
    const { container } = renderShield();
    await waitFor(() => expect(getAttestation).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
