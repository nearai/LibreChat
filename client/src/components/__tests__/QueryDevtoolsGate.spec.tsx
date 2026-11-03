import { render, screen, waitFor } from '@testing-library/react';
import QueryDevtoolsGate, { shouldEnableQueryDevtools } from '../QueryDevtoolsGate';

jest.mock('@tanstack/react-query-devtools/production', () => ({
  ReactQueryDevtools: () => <div data-testid="query-devtools" />,
}));

describe('QueryDevtoolsGate', () => {
  it('keeps query devtools disabled in production by default', () => {
    expect(shouldEnableQueryDevtools({ isDevelopment: false, config: undefined })).toBe(false);

    const { container } = render(<QueryDevtoolsGate isDevelopment={false} config={undefined} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('query-devtools')).not.toBeInTheDocument();
  });

  it('keeps query devtools out of local development unless the developer opts in', () => {
    const { container } = render(
      <QueryDevtoolsGate isDevelopment={true} devOptIn={false} config={undefined} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('enables query devtools in local development when the developer opts in', async () => {
    render(<QueryDevtoolsGate isDevelopment={true} devOptIn={true} config={undefined} />);

    await waitFor(() => expect(screen.getByTestId('query-devtools')).toBeInTheDocument());
  });

  it('ignores the development opt-in in a production build', () => {
    expect(
      shouldEnableQueryDevtools({ isDevelopment: false, devOptIn: true, config: undefined }),
    ).toBe(false);
  });

  it('enables query devtools in production when the server-injected flag is true', async () => {
    render(<QueryDevtoolsGate isDevelopment={false} config={{ enableQueryDevtools: true }} />);

    await waitFor(() => expect(screen.getByTestId('query-devtools')).toBeInTheDocument());
  });
});
