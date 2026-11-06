import React from 'react';
import { RecoilRoot } from 'recoil';
import '@testing-library/jest-dom/extend-expect';
import { MemoryRouter } from 'react-router-dom';
import { render, fireEvent, screen } from '@testing-library/react';
import type { TInterfaceConfig } from 'librechat-data-provider';
import { ActivePanelProvider, DEFAULT_PANEL } from '~/Providers';

const mockNewConversation = jest.fn();
let mockStartupConfig:
  | { appTitle?: string; interface?: Pick<TInterfaceConfig, 'brand'> }
  | undefined;

jest.mock('~/store', () => {
  const { atom } = jest.requireActual('recoil');
  return {
    __esModule: true,
    default: {
      customShortcuts: atom({ key: 'mock-masthead-customShortcuts', default: {} }),
      shortcutsEnabled: atom({ key: 'mock-masthead-shortcutsEnabled', default: true }),
    },
  };
});

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: mockStartupConfig }),
}));

/** Mirrors the real hook's click contract so the panel switch runs through `onNewChat`. */
jest.mock('~/hooks/Chat/useNewChat', () => ({
  __esModule: true,
  default: ({ onNewChat }: { onNewChat?: () => void } = {}) => ({
    handleNewChatClick: (event: React.MouseEvent<HTMLElement>) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }
      event.preventDefault();
      mockNewConversation();
      onNewChat?.();
    },
  }),
}));

jest.mock('~/utils', () => ({
  DEFAULT_APP_TITLE: 'LibreChat',
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

import Masthead, { NewChatRow } from '../Masthead';

function renderMasthead({
  initialPanel = DEFAULT_PANEL,
  switchToHistory = true,
}: { initialPanel?: string; switchToHistory?: boolean } = {}) {
  if (initialPanel !== DEFAULT_PANEL) {
    localStorage.setItem('side:active-panel', initialPanel);
  }
  return render(
    <MemoryRouter>
      <RecoilRoot>
        <ActivePanelProvider>
          <Masthead />
          <NewChatRow switchToHistory={switchToHistory} />
        </ActivePanelProvider>
      </RecoilRoot>
    </MemoryRouter>,
  );
}

describe('Masthead', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockStartupConfig = undefined;
  });

  describe('title', () => {
    it('names the app in text when no brand is configured', () => {
      mockStartupConfig = { appTitle: 'Private AI' };
      renderMasthead();

      expect(screen.getByText('Private AI')).toBeInTheDocument();
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('falls back to the default title before the config answers', () => {
      renderMasthead();

      expect(screen.getByText('LibreChat')).toBeInTheDocument();
    });

    it('draws the configured mark and a wordmark per color mode in place of the title', () => {
      mockStartupConfig = {
        appTitle: 'Private AI',
        interface: {
          brand: {
            mark: '/assets/mark.svg',
            wordmark: { light: '/assets/wordmark-black.svg', dark: '/assets/wordmark-white.svg' },
          },
        },
      };
      const { container } = renderMasthead();

      const wordmarks = screen.getAllByRole('img', { name: 'com_ui_logo:Private AI' });
      expect(wordmarks.map((img) => img.getAttribute('src'))).toEqual([
        '/assets/wordmark-black.svg',
        '/assets/wordmark-white.svg',
      ]);
      expect(wordmarks[0]).toHaveClass('dark:hidden');
      expect(wordmarks[1]).toHaveClass('hidden', 'dark:block');
      /** The mark is decorative beside a named wordmark. */
      expect(container.querySelector('img[src="/assets/mark.svg"]')).toHaveAttribute('alt', '');
      expect(screen.queryByText('Private AI')).not.toBeInTheDocument();
    });

    it('keeps the text title when only a mark is configured', () => {
      mockStartupConfig = { appTitle: 'Private AI', interface: { brand: { mark: '/m.svg' } } };
      renderMasthead();

      expect(screen.getByText('Private AI')).toBeInTheDocument();
    });
  });

  describe('New chat', () => {
    it('switches to the chat history panel when the setting is on', () => {
      renderMasthead({ initialPanel: 'prompts' });

      fireEvent.click(screen.getByTestId('new-chat-button'));

      expect(mockNewConversation).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('side:active-panel')).toBe(DEFAULT_PANEL);
    });

    it('keeps the current panel when the setting is off', () => {
      renderMasthead({ initialPanel: 'prompts', switchToHistory: false });

      fireEvent.click(screen.getByTestId('new-chat-button'));

      expect(mockNewConversation).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('side:active-panel')).toBe('prompts');
    });

    it('leaves modified clicks to the browser so the link opens in a new tab', () => {
      renderMasthead();

      fireEvent.click(screen.getByTestId('new-chat-button'), { metaKey: true });

      expect(mockNewConversation).not.toHaveBeenCalled();
      expect(screen.getByTestId('new-chat-button')).toHaveAttribute('href', '/c/new');
    });
  });
});
