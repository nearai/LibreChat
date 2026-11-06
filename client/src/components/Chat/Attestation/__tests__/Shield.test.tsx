import React from 'react';
import { RecoilRoot } from 'recoil';
import { dataService } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TNearAIAttestationResponse } from 'librechat-data-provider';
import { BADGE_200, SEAL_BAND, SEAL_ROSE } from '../geometry';
import Shield from '../Shield';

const MODEL = 'z-ai/glm-5.3-flash';

const drawnPaths = (seal: HTMLElement) =>
  Array.from(seal.querySelectorAll('path')).map((path) => path.getAttribute('d'));

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

function renderShield() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
    for (const check of ['NEAR AI Gateway', 'CPU enclave', 'GPU', 'Signing key and model']) {
      expect(within(dialog).getByText(check)).toBeInTheDocument();
    }
    expect(
      within(dialog).getByText(
        `Hardware evidence for ${MODEL} passed these checks. This says nothing about earlier replies.`,
      ),
    ).toBeVisible();
    expect(within(dialog).queryByText(/seal/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Copy/ })).toBeNull();
    expect(within(dialog).getByRole('link', { name: /Open full report/ })).toHaveAttribute(
      'href',
      `https://cloud.near.ai/verify?model=${encodeURIComponent(MODEL)}`,
    );
  });

  it('draws the detailed seal at 56 px once the model verifies', async () => {
    getAttestation.mockResolvedValueOnce(verified);
    renderShield();

    fireEvent.click(await screen.findByRole('button', { name: 'NEAR AI proof: Verified' }));
    const seal = within(await screen.findByRole('dialog')).getByTestId('proof-seal');

    expect(seal).toHaveStyle({ width: '56px', height: '56px' });
    expect(drawnPaths(seal)).toEqual(expect.arrayContaining([SEAL_BAND, SEAL_ROSE]));
    expect(seal.querySelector('circle')).toBeNull();
  });

  it('draws a dashed ring, not the strands, while nothing is verified', async () => {
    getAttestation.mockReturnValueOnce(new Promise(() => undefined));
    renderShield();

    fireEvent.click(await screen.findByRole('button', { name: 'NEAR AI proof: Checking' }));
    const seal = within(await screen.findByRole('dialog')).getByTestId('proof-seal');

    expect(seal).toHaveStyle({ width: '56px', height: '56px' });
    expect(drawnPaths(seal)).not.toContain(SEAL_BAND);
    expect(drawnPaths(seal)).not.toContain(SEAL_ROSE);
    /** A badge this small has no room for the spinner to read as one. */
    expect(drawnPaths(seal)).not.toContain(BADGE_200);
    expect(seal.querySelector('circle')).toHaveAttribute('stroke-dasharray', '3 4');
  });

  it('draws no strands when the check failed', async () => {
    getAttestation.mockResolvedValueOnce({ ...verified, status: 'failed', errorCode: 'tdx.quote' });
    renderShield();

    fireEvent.click(await screen.findByRole('button', { name: 'NEAR AI proof: Check failed' }));
    const seal = within(await screen.findByRole('dialog')).getByTestId('proof-seal');

    expect(drawnPaths(seal)).not.toContain(SEAL_BAND);
    expect(seal.querySelector('circle')).toHaveAttribute('stroke-dasharray', '3 4');
  });

  it('keeps the status word visible after verifying', async () => {
    jest.useFakeTimers();
    try {
      getAttestation.mockResolvedValueOnce(verified);
      renderShield();

      const pill = await screen.findByRole('button', { name: 'NEAR AI proof: Verified' });
      act(() => {
        jest.advanceTimersByTime(60_000);
      });
      const word = within(pill).getByText('Verified');
      expect(word).toBeVisible();
      expect(word.className).not.toMatch(/max-w-0|opacity-0/);
      expect(pill.className).not.toMatch(/gap-0/);
    } finally {
      jest.useRealTimers();
    }
  });

  it('claims no result while the checks are in flight', async () => {
    getAttestation.mockReturnValueOnce(new Promise(() => undefined));
    renderShield();

    fireEvent.click(await screen.findByRole('button', { name: 'NEAR AI proof: Checking' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText(/passed/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Intel TDX quote is valid')).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/seal/i)).not.toBeInTheDocument();
  });

  it("gives Intel's status for the platform, not a verdict on its firmware", async () => {
    getAttestation.mockResolvedValueOnce({
      ...verified,
      checks: { gateway: 'passed', cpu: 'passed', gpu: 'passed', key: 'passed' },
      tcbStatus: 'OutOfDate',
    });
    renderShield();

    fireEvent.click(await screen.findByRole('button', { name: 'NEAR AI proof: Verified' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(
        'Intel TDX quote is valid. Intel lists this platform as OutOfDate in its default data set.',
      ),
    ).toBeVisible();
    expect(within(dialog).getByText('Enclave quote is valid')).toBeVisible();
    expect(within(dialog).getByText("NVIDIA's signed verdict: passed")).toBeVisible();
    expect(within(dialog).getByText('Key bound to this hardware')).toBeVisible();
    expect(within(dialog).queryByText(/up to date|published/i)).not.toBeInTheDocument();
  });

  it('gives no status when the server reports none', async () => {
    getAttestation.mockResolvedValueOnce({
      ...verified,
      checks: { gateway: 'passed', cpu: 'passed', gpu: 'passed', key: 'passed' },
    });
    renderShield();

    fireEvent.click(await screen.findByRole('button', { name: 'NEAR AI proof: Verified' }));
    expect(await screen.findByText('Intel TDX quote is valid')).toBeVisible();
  });

  it('flags a GPU check that had no evidence to examine', async () => {
    getAttestation.mockResolvedValueOnce({
      ...verified,
      checks: { gateway: 'passed', cpu: 'passed', gpu: 'not_provided', key: 'passed' },
    });
    renderShield();

    fireEvent.click(await screen.findByRole('button', { name: 'NEAR AI proof: Verified' }));
    const dialog = await screen.findByRole('dialog');
    const gpu = within(dialog).getByText('GPU').closest('li') as HTMLElement;
    expect(within(gpu).getByText('No evidence was sent, so this is not proven')).toBeVisible();
    expect(within(gpu).getByText(': needs attention')).toBeInTheDocument();
    expect(within(dialog).getByText('Intel TDX quote is valid')).toBeVisible();
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
