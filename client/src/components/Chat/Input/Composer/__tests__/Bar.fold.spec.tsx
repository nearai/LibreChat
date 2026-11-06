import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render, screen } from '@testing-library/react';
import type { PaletteEntry } from '~/hooks/Input/usePaletteEntries';
import type { Dictation } from '~/hooks/Input/useDictation';

let mockEntries: PaletteEntry[] = [];

jest.mock('~/hooks/Input/usePaletteEntries', () => ({
  __esModule: true,
  default: () => mockEntries,
}));
jest.mock('~/hooks/Input/useToolFavorites', () => ({
  __esModule: true,
  default: () => ({ keys: [] }),
}));
jest.mock('~/Providers', () => ({ useBadgeRowContext: () => null }));
jest.mock('~/hooks', () => ({ useLocalize: () => (key: string) => key }));
jest.mock('~/components/MCP/MCPConfigDialog', () => ({ __esModule: true, default: () => null }));
jest.mock('../../TokenUsage', () => ({ __esModule: true, default: () => null }));
jest.mock('../Thinking', () => ({ __esModule: true, default: () => null }));
jest.mock('../Palette', () => ({
  __esModule: true,
  default: () => <button type="button" aria-label="com_ui_attach_and_tools" />,
}));

import Bar from '../Bar';

const MODEL = 'Qwen/Qwen3.6-35B-A3B-FP8';

const idleDictation: Dictation = {
  active: false,
  transcribing: false,
  startDisabled: false,
  elapsed: 0,
  start: jest.fn(),
  cancel: jest.fn(),
  stopToComposer: jest.fn(),
  stopAndSend: jest.fn(),
};

const entry = (key: string): PaletteEntry => ({
  key,
  itemType: 'builtin',
  itemId: key,
  label: key,
  icon: null,
  section: 'tool',
  active: true,
  pinned: false,
  onSelect: jest.fn(),
});

function renderBar({
  fold = true,
  modelSlot,
  dictation = idleDictation,
}: {
  fold?: boolean;
  modelSlot?: React.ReactNode;
  dictation?: Dictation;
} = {}) {
  return render(
    <Bar
      index={0}
      isRTL={false}
      disabled={false}
      conversationId="new"
      conversation={null}
      files={new Map()}
      setFiles={jest.fn()}
      setFilesLoading={jest.fn()}
      canAttach
      anchorRef={{ current: null }}
      showTools
      isSubmitting={false}
      showSpeech={false}
      speechDisabled={false}
      hasAddedConversation={false}
      modelSlot={modelSlot}
      fold={fold}
      actionSlot={<button type="submit" aria-label="send" />}
      dictation={dictation}
    />,
  );
}

describe('Bar folding', () => {
  beforeEach(() => {
    mockEntries = [];
  });

  it('folds into the text row when the composer allows it and the bar has nothing else', () => {
    const { container } = renderBar();

    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute('data-folded', 'true');
    expect(root).toHaveClass('contents');
  });

  it('keeps its own row when the composer does not allow folding', () => {
    const { container } = renderBar({ fold: false });

    expect(container.querySelector('[data-folded]')).toBeNull();
  });

  it('keeps its own row while it carries the model picker, leading with it beside the +', () => {
    const { container } = renderBar({
      modelSlot: <button type="button">{MODEL}</button>,
    });

    expect(container.querySelector('[data-folded]')).toBeNull();
    const picker = screen.getByRole('button', { name: MODEL });
    const plus = screen.getByRole('button', { name: 'com_ui_attach_and_tools' });
    /** One leading group: the picker follows the + rather than joining the trailing controls. */
    expect(plus.parentElement).toContainElement(picker);
    expect(screen.getByRole('button', { name: 'send' }).parentElement).not.toContainElement(picker);
  });

  it('keeps its own row while it shows chips', () => {
    mockEntries = [entry('web_search')];
    const { container } = renderBar();

    expect(container.querySelector('[data-folded]')).toBeNull();
  });

  it('keeps its own row while dictating, which needs the row for its timer', () => {
    const { container } = renderBar({ dictation: { ...idleDictation, active: true } });

    expect(container.querySelector('[data-folded]')).toBeNull();
  });
});
