import React from 'react';
import { RecoilRoot } from 'recoil';
import copy from 'copy-to-clipboard';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TMessage, TNearAIReceipt } from 'librechat-data-provider';
import Signature from '../Signature';

const KEY = '5a0210f2442c79355784f9de021985429561da5bacc3a4424b01ac52b7e0caff';
const MODEL = 'z-ai/glm-5.3-flash';
const REQUEST_HASH = 'eb04497ea35a7733b643a07fea5ddc544d3015ec5249303169946adb38653bac';
const RESPONSE_HASH = '81c8a97038d2a8efb7f91a5c2e08fa35dead6b91194a1511d201244e2538fccc';
const conversation = { endpoint: 'NEAR AI', model: MODEL };

/** The HTTP boundary: a plain copy of `dataService` so its request can be spied on. */
jest.mock('librechat-data-provider', () => {
  const actual =
    jest.requireActual<typeof import('librechat-data-provider')>('librechat-data-provider');
  return { ...actual, dataService: { ...actual.dataService } };
});

jest.mock('copy-to-clipboard', () => jest.fn());

const receipt = (overrides: Partial<TNearAIReceipt> = {}): TNearAIReceipt => ({
  completionId: 'chatcmpl-1',
  model: MODEL,
  status: 'verified',
  verifiedAt: '2026-11-02T22:18:00.000Z',
  signatureKind: 'provider_tee',
  signingAlgo: 'ed25519',
  signingAddress: KEY,
  signedText: `${MODEL}:${REQUEST_HASH}:${RESPONSE_HASH}`,
  signature: '85daa0fe',
  ...overrides,
});

const gatewayReceipt = (overrides: Partial<TNearAIReceipt> = {}) =>
  receipt({
    signatureKind: 'gateway',
    signedText: `${REQUEST_HASH}:${RESPONSE_HASH}`,
    ...overrides,
  });

const reply = (receipts: TNearAIReceipt[], overrides: Partial<TMessage> = {}): TMessage =>
  ({
    messageId: 'm-1',
    conversationId: 'c-1',
    endpoint: 'NEAR AI',
    isCreatedByUser: false,
    text: 'Mercury, Venus and Earth.',
    metadata: receipts.length > 0 ? { nearai: { receipts } } : undefined,
    ...overrides,
  }) as TMessage;

function renderSignature(message: TMessage, isStreaming = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData([QueryKeys.messages, 'c-1'], [message]);
  return render(
    <Signature message={message} conversation={conversation} isStreaming={isStreaming} />,
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          <RecoilRoot>{children}</RecoilRoot>
        </QueryClientProvider>
      ),
    },
  );
}

async function openProof(word: string) {
  fireEvent.click(screen.getByRole('button', { name: `NEAR AI reply proof: ${word}` }));
  return screen.findByRole('dialog');
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
  it('shows a model-signed reply as model signed, saying only what its checks show', async () => {
    renderSignature(reply([receipt()]));

    const dialog = await openProof('Model signed');
    expect(within(dialog).getByText('Signed by the verified model')).toBeVisible();
    expect(
      within(dialog).getByText(
        "The model's key signed this exact reply and the request hash the attested Gateway passed to it.",
      ),
    ).toBeVisible();
    expect(within(dialog).getByText('ED25519, over this reply and its request hash')).toBeVisible();
    expect(within(dialog).getByText('Signer is the attested model')).toBeVisible();
    expect(within(dialog).getByText("Same key as this chat's model check")).toBeVisible();
    expect(within(dialog).getByText(`Signed for ${MODEL}`)).toBeVisible();
    expect(within(dialog).getByText('Model name is inside what was signed')).toBeVisible();

    const link = await within(dialog).findByRole('link', { name: /Verify on NEAR AI/ });
    expect(link.getAttribute('href')).toMatch(/#receipt=/);
  });

  it('shows no seal code, seal comparison or header link', async () => {
    renderSignature(reply([receipt()]));

    const dialog = await openProof('Model signed');
    expect(within(dialog).queryByText(/seal/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Show in header' })).toBeNull();
  });

  it('draws the same seal whichever key signed', async () => {
    const outline = async (signingAddress: string) => {
      const { unmount } = renderSignature(reply([receipt({ signingAddress })]));
      const dialog = await openProof('Model signed');
      const seal = dialog.querySelector('svg path')?.getAttribute('d');
      unmount();
      return seal;
    };
    expect(await outline(KEY)).toEqual(await outline('ab'.repeat(32)));
  });

  it('names the Gateway when it signed, and says the model name is not covered', async () => {
    renderSignature(reply([gatewayReceipt()]));

    const dialog = await openProof('Gateway signed');
    expect(within(dialog).getByText('Signed by the NEAR AI Gateway')).toBeVisible();
    expect(within(dialog).getByText('Over the exact question and reply')).toBeVisible();
    expect(within(dialog).getByText('Signer is the attested gateway')).toBeVisible();
    expect(within(dialog).getByText("Same key as this chat's gateway check")).toBeVisible();
    expect(within(dialog).getByText('Model name is not in what was signed')).toBeVisible();
    expect(within(dialog).queryByText(`Signed for ${MODEL}`)).not.toBeInTheDocument();
  });

  it('takes the word from the signature, whether or not the call streamed', async () => {
    const { rerender } = renderSignature(reply([]), true);
    expect(await screen.findByRole('button', { name: /Signing/ })).toBeVisible();

    rerender(
      <Signature message={reply([receipt()])} conversation={conversation} isStreaming={false} />,
    );
    expect(screen.getByRole('button', { name: 'NEAR AI reply proof: Model signed' })).toBeVisible();
  });

  it('says a reply changed in the app differs from what was signed', async () => {
    renderSignature(reply([receipt()], { userSubmittedPaths: ['/text'] }));

    const dialog = await openProof('Edited after signing');
    expect(within(dialog).getByRole('heading')).toHaveTextContent('Edited after signing');
    expect(
      within(dialog).getByText(
        'This reply was changed in this app after it was signed. The signature covers the original reply only.',
      ),
    ).toBeVisible();
    expect(within(dialog).getByText('For the reply as it was signed')).toBeVisible();

    const changed = within(dialog)
      .getByText('Shown text differs from what was signed')
      .closest('li') as HTMLElement;
    expect(within(changed).getByText('Changed in this app after signing')).toBeVisible();
    expect(within(changed).getByText(': needs attention')).toBeInTheDocument();
    expect(within(dialog).getByText('Signer is the attested model')).toBeVisible();
  });

  it('keeps naming the Gateway on an edited Gateway-signed reply', async () => {
    renderSignature(reply([gatewayReceipt()], { userSubmittedPaths: ['/content/0/text'] }));

    const dialog = await openProof('Edited after signing');
    expect(within(dialog).getByText('Signer is the attested gateway')).toBeVisible();
  });

  it('does not count tool input as an edit to the reply', async () => {
    renderSignature(reply([receipt()], { userSubmittedPaths: ['/content/2/tool_call/args'] }));
    expect(screen.getByRole('button', { name: 'NEAR AI reply proof: Model signed' })).toBeVisible();
  });

  it('fails plainly and runs nothing after the signature', async () => {
    renderSignature(
      reply([receipt({ status: 'failed', errorCode: 'signature.invalid', signature: undefined })]),
    );

    const dialog = await openProof('Check failed');
    expect(within(dialog).getByText('Signature did not check out')).toBeVisible();
    expect(within(dialog).getAllByText('Not run')).toHaveLength(2);
    expect(within(dialog).queryByText(/attested/)).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Treat what it says as unverified/)).toBeVisible();
  });

  it('lets a failed signature outrank an edit', async () => {
    renderSignature(
      reply([receipt({ status: 'failed', errorCode: 'signature.invalid' })], {
        userSubmittedPaths: ['/text'],
      }),
    );
    expect(screen.getByRole('button', { name: 'NEAR AI reply proof: Check failed' })).toBeVisible();
  });

  it('says not signed, and why, when no signature was available', async () => {
    renderSignature(
      reply([
        receipt({
          status: 'failed',
          errorCode: 'api.completion_signature_unavailable',
          signatureKind: undefined,
          signingAddress: undefined,
          signedText: undefined,
          signature: undefined,
        }),
      ]),
    );

    const dialog = await openProof('Not signed');
    expect(
      within(dialog).getByText('No signature is available for this reply. Treat it as unverified.'),
    ).toBeVisible();
    expect(within(dialog).getByText('No signature to check')).toBeVisible();
    expect(within(dialog).getByText('Reason: api.completion_signature_unavailable')).toBeVisible();
    expect(within(dialog).getAllByText('Not run')).toHaveLength(2);
    expect(within(dialog).queryByText(/attested/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Signed for/)).not.toBeInTheDocument();
  });

  it('does not guess the signer when the receipt does not record it', async () => {
    renderSignature(reply([receipt({ signatureKind: undefined })]));

    const dialog = await openProof('Signer not classified');
    expect(within(dialog).getByRole('heading')).toHaveTextContent('Signer not classified');
    expect(within(dialog).getByText('ED25519, over the text in the receipt')).toBeVisible();
    expect(within(dialog).getByText("This receipt doesn't say whose key signed it")).toBeVisible();
    expect(screen.queryByRole('button', { name: /Gateway signed/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Model signed/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Signer is the attested gateway')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Signer is the attested model')).not.toBeInTheDocument();
  });

  it('folds the receipt fields away until asked', async () => {
    renderSignature(reply([receipt()]));

    const dialog = await openProof('Model signed');
    const toggle = within(dialog).getByRole('button', { name: 'Proof data' });
    expect(screen.queryByText('chatcmpl-1')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('chatcmpl-1')).toBeVisible();
  });

  it.each([
    ['the model', receipt],
    ['the Gateway', gatewayReceipt],
  ])('lists the request and response hashes of a reply %s signed', async (_signer, make) => {
    renderSignature(reply([make()]));

    fireEvent.click(screen.getByTestId('nearai-signature-button'));
    fireEvent.click(await screen.findByRole('button', { name: 'Proof data' }));

    expect(screen.getByText('Request hash')).toBeVisible();
    expect(screen.getByText(REQUEST_HASH)).toBeVisible();
    expect(screen.getByText('Response hash')).toBeVisible();
    expect(screen.getByText(RESPONSE_HASH)).toBeVisible();
    expect(screen.queryByText('Signed text')).not.toBeInTheDocument();
  });

  it('names who signed in the proof data', async () => {
    renderSignature(reply([receipt()]));

    const dialog = await openProof('Model signed');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Proof data' }));
    const signedBy = within(dialog).getByText('Signed by').parentElement as HTMLElement;
    expect(within(signedBy).getByText(MODEL)).toBeVisible();
  });

  it('copies each field, and every field at once', async () => {
    renderSignature(
      reply([receipt(), gatewayReceipt({ completionId: 'chatcmpl-2', signature: 'c0ffee' })]),
    );

    const dialog = await openProof('Gateway signed');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Proof data' }));

    for (const field of [
      'Completion ID',
      'Signed by',
      'Algorithm',
      'Signer',
      'Request hash',
      'Response hash',
      'Signature',
    ]) {
      expect(within(dialog).getAllByRole('button', { name: `Copy ${field}` })).toHaveLength(2);
    }

    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Copy Request hash' })[0]);
    expect(copy).toHaveBeenLastCalledWith(REQUEST_HASH);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy all proof data' }));
    const all = (copy as unknown as jest.Mock).mock.lastCall?.[0] as string;
    expect(all).toContain('Completion ID: chatcmpl-1');
    expect(all).toContain(`Signed by: ${MODEL}`);
    expect(all).toContain(`Signer: ${KEY}`);
    expect(all).toContain(`Request hash: ${REQUEST_HASH}`);
    expect(all).toContain(`Response hash: ${RESPONSE_HASH}`);
    expect(all).toContain('Signature: 85daa0fe');
    expect(all).toContain('\n\nCompletion ID: chatcmpl-2');
    expect(all).toContain('Signed by: NEAR AI Gateway');
  });

  it('keeps the header word for the deployment, separate from the reply word', async () => {
    renderSignature(reply([receipt()]));
    expect(screen.queryByRole('button', { name: /Verified/ })).not.toBeInTheDocument();
  });

  it('offers Copy all before the proof data is opened', async () => {
    renderSignature(reply([receipt()]));

    const dialog = await openProof('Model signed');
    expect(within(dialog).getByRole('button', { name: 'Copy all proof data' })).toHaveTextContent(
      'Copy all',
    );
  });

  it('shows signed text it cannot split as it is', async () => {
    renderSignature(reply([receipt({ signedText: 'an-older-format' })]));

    const dialog = await openProof('Model signed');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Proof data' }));
    expect(within(dialog).getByText('Signed text')).toBeVisible();
    expect(within(dialog).getByText('an-older-format')).toBeVisible();
    expect(within(dialog).queryByText('Request hash')).not.toBeInTheDocument();
  });

  it('waits as signing while a NEAR AI reply streams', async () => {
    renderSignature(reply([]), true);

    const tag = await screen.findByRole('button', { name: 'NEAR AI reply proof: Signing' });
    expect(tag).toHaveAttribute('aria-disabled', 'true');
    expect(tag).toHaveAttribute('title', "Waiting for this reply's signature.");
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
