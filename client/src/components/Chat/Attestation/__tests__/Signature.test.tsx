import React from 'react';
import { RecoilRoot } from 'recoil';
import { useAtomValue } from 'jotai';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TMessage, TNearAIReceipt } from 'librechat-data-provider';
import { proofPulseAtom } from '../state';
import Signature from '../Signature';

const KEY = '5a0210f2442c79355784f9de021985429561da5bacc3a4424b01ac52b7e0caff';
const MODEL = 'z-ai/glm-5.3-flash';
const conversation = { endpoint: 'NEAR AI', model: MODEL };

/** The HTTP boundary: a plain copy of `dataService` so its request can be spied on. */
jest.mock('librechat-data-provider', () => {
  const actual =
    jest.requireActual<typeof import('librechat-data-provider')>('librechat-data-provider');
  return { ...actual, dataService: { ...actual.dataService } };
});

const receipt = (overrides: Partial<TNearAIReceipt> = {}): TNearAIReceipt => ({
  completionId: 'chatcmpl-1',
  model: MODEL,
  status: 'verified',
  verifiedAt: '2026-11-02T22:18:00.000Z',
  signatureKind: 'provider_tee',
  signingAlgo: 'ed25519',
  signingAddress: KEY,
  signedText: 'sha256:request:sha256:response',
  signature: '85daa0fe',
  ...overrides,
});

const reply = (receipts: TNearAIReceipt[]): TMessage =>
  ({
    messageId: 'm-1',
    conversationId: 'c-1',
    endpoint: 'NEAR AI',
    isCreatedByUser: false,
    text: 'Mercury, Venus and Earth.',
    metadata: receipts.length > 0 ? { nearai: { receipts } } : undefined,
  }) as TMessage;

function Pulse() {
  return <output aria-label="pulse">{useAtomValue(proofPulseAtom)}</output>;
}

function renderSignature(message: TMessage, isStreaming = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData([QueryKeys.messages, 'c-1'], [message]);
  return render(
    <>
      <Signature message={message} conversation={conversation} isStreaming={isStreaming} />
      <Pulse />
    </>,
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          <RecoilRoot>{children}</RecoilRoot>
        </QueryClientProvider>
      ),
    },
  );
}

/** `restoreMocks` undoes spies after each test, so each test installs its own. */
let getAttestation: jest.SpiedFunction<typeof dataService.getNearAIAttestation>;
beforeEach(() => {
  getAttestation = jest.spyOn(dataService, 'getNearAIAttestation').mockResolvedValue({
    enabled: true,
    model: MODEL,
    status: 'verified',
    checkedAt: new Date().toISOString(),
    verifyUrl: 'https://cloud.near.ai/verify',
  });
});

describe('Signature', () => {
  it('shows a model-signed reply as verified, with its checks and seal', async () => {
    renderSignature(reply([receipt()]));

    fireEvent.click(screen.getByRole('button', { name: 'NEAR AI reply proof: Verified' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Signed by the verified model')).toBeVisible();
    expect(within(dialog).getByText('ED25519, over the exact question and reply')).toBeVisible();
    expect(within(dialog).getByText('Signer is the attested model')).toBeVisible();
    expect(within(dialog).getByText(`Signed for ${MODEL}`)).toBeVisible();
    expect(
      within(dialog).getByText("matches the seal in this chat's header.", { exact: false }),
    ).toBeVisible();

    const link = await within(dialog).findByRole('link', { name: /Verify on NEAR AI/ });
    expect(link.getAttribute('href')).toMatch(/#receipt=/);
  });

  it('compares the reply with the session key the header draws', async () => {
    getAttestation.mockResolvedValue({
      enabled: true,
      model: MODEL,
      status: 'verified',
      checkedAt: new Date().toISOString(),
      signingKey: { signingAlgo: 'ed25519', signingAddress: 'ab'.repeat(32) },
    });
    renderSignature(reply([receipt()]));

    fireEvent.click(screen.getByRole('button', { name: 'NEAR AI reply proof: Verified' }));
    expect(
      await screen.findByText("differs from the seal in this chat's header", { exact: false }),
    ).toBeVisible();
  });

  it('matches the session key however its hex is spelled', async () => {
    getAttestation.mockResolvedValue({
      enabled: true,
      model: MODEL,
      status: 'verified',
      checkedAt: new Date().toISOString(),
      signingKey: { signingAlgo: 'ed25519', signingAddress: `0x${KEY.toUpperCase()}` },
    });
    renderSignature(reply([receipt()]));

    fireEvent.click(screen.getByRole('button', { name: 'NEAR AI reply proof: Verified' }));
    expect(
      await screen.findByText("matches the seal in this chat's header.", { exact: false }),
    ).toBeVisible();
  });

  it('rings the header seal on request', async () => {
    renderSignature(reply([receipt()]));

    fireEvent.click(screen.getByRole('button', { name: 'NEAR AI reply proof: Verified' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Show in header' }));
    expect(screen.getByLabelText('pulse')).toHaveTextContent('1');
  });

  it('folds the receipt fields away until asked', async () => {
    renderSignature(reply([receipt()]));

    fireEvent.click(screen.getByRole('button', { name: 'NEAR AI reply proof: Verified' }));
    const toggle = await screen.findByRole('button', { name: 'Proof data' });
    expect(screen.queryByText('chatcmpl-1')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('chatcmpl-1')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy Signer' })).toBeVisible();
  });

  it('warns when only the Gateway signed', async () => {
    renderSignature(reply([receipt({ signatureKind: 'gateway' })]));

    fireEvent.click(screen.getByRole('button', { name: 'NEAR AI reply proof: Gateway signed' }));
    expect(await screen.findByText('Signer is the NEAR AI Gateway')).toBeVisible();
  });

  it('fails plainly and runs nothing after the signature', async () => {
    renderSignature(
      reply([receipt({ status: 'failed', errorCode: 'signature.invalid', signature: undefined })]),
    );

    fireEvent.click(screen.getByRole('button', { name: 'NEAR AI reply proof: Check failed' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Signature did not check out')).toBeVisible();
    expect(within(dialog).getAllByText('Not run')).toHaveLength(2);
  });

  it('waits as signing while a NEAR AI reply streams', async () => {
    renderSignature(reply([]), true);

    const tag = await screen.findByRole('button', { name: 'NEAR AI reply proof: Signing' });
    expect(tag).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows nothing for a streaming reply outside NEAR AI', async () => {
    getAttestation.mockResolvedValue({ enabled: false });
    renderSignature(reply([]), true);

    await waitFor(() => expect(getAttestation).toHaveBeenCalled());
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows nothing for a finished reply without receipts', () => {
    renderSignature(reply([]));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(getAttestation).not.toHaveBeenCalled();
  });
});
