import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThinkingButton, ThinkingLabel } from '../Thinking';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useExpandCollapse: () => ({ style: {}, ref: { current: null } }),
}));

jest.mock('~/store/fontSize', () => ({
  fontSizeAtom: { toString: () => 'fontSizeAtom' },
}));

jest.mock('jotai', () => ({
  ...jest.requireActual('jotai'),
  useAtomValue: () => 'text-xl',
}));

jest.mock('~/components/Messages/Content/CopyButton', () => ({
  __esModule: true,
  default: () => <button type="button" data-testid="copy-thoughts" />,
}));

/** Every activity row — a tool call, a grouped thought, a phase summary — is
 *  set at `tool-status-text`. A reasoning header sized to the reader's body
 *  text instead was the one row that grew with that setting, so the same
 *  thought read at two sizes depending on which surface held it. */
describe('reasoning header rows', () => {
  it('sets the thinking disclosure at the shared row scale, not the body size', () => {
    render(
      <ThinkingButton
        isExpanded={false}
        onClick={() => {}}
        label="Reframing the analysis"
        contentId="thoughts"
      />,
    );
    const button = screen.getByRole('button', { name: 'Reframing the analysis' });
    expect(button).toHaveClass('tool-status-text');
    expect(button).not.toHaveClass('text-xl');
    expect(screen.getByText('Reframing the analysis')).toHaveClass('font-medium');
  });

  it('sets the non-interactive marker the same way', () => {
    render(<ThinkingLabel label="Thoughts" />);
    const label = screen.getByText('Thoughts');
    expect(label.parentElement).toHaveClass('tool-status-text');
    expect(label.parentElement).not.toHaveClass('text-xl');
    expect(label).toHaveClass('font-medium');
  });
});

describe('reasoning header glyph and caret', () => {
  it('ends the label with the disclosure caret rather than swapping it for the glyph', () => {
    render(
      <ThinkingButton
        isExpanded={false}
        onClick={() => {}}
        label="Thoughts"
        contentId="thoughts"
      />,
    );
    const button = screen.getByRole('button', { name: 'Thoughts' });
    const label = screen.getByText('Thoughts');
    const caret = button.querySelector('svg.lucide-chevron-down');
    expect(caret).not.toBeNull();
    /** The caret follows the label in reading order and is the button's last child. */
    expect(label.compareDocumentPosition(caret as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(button.lastElementChild).toBe(caret);
  });

  it('turns the caret while the thoughts are open', () => {
    render(<ThinkingButton isExpanded onClick={() => {}} label="Thoughts" contentId="thoughts" />);
    const caret = screen.getByRole('button', { name: 'Thoughts' }).lastElementChild;
    expect(caret).toHaveClass('rotate-180');
  });

  /** A brand with its own process mark drops the settled lightbulb, slot and all (style.css), so
   *  the glyph must sit in the slot that carries the marker. */
  it('keeps the settled lightbulb in the slot a brand mark can drop', () => {
    render(
      <ThinkingButton
        isExpanded={false}
        onClick={() => {}}
        label="Thoughts"
        contentId="thoughts"
      />,
    );
    const bulb = screen
      .getByRole('button', { name: 'Thoughts' })
      .querySelector('.lucide-lightbulb');
    expect(bulb?.parentElement).toHaveClass('lc-reasoning-slot');
    expect(
      screen.getByRole('button', { name: 'Thoughts' }).querySelector('.lc-live-mark'),
    ).toBeNull();
  });

  /** While the reasoning streams, the brand's mark leads the thought: the slot stays, and holds
   *  the working mark beside the lightbulb it replaces (style.css picks one). */
  it('carries the working mark in a kept slot while the reasoning streams', () => {
    render(
      <ThinkingButton
        isExpanded={false}
        onClick={() => {}}
        label="Weighing contrast"
        contentId="thoughts"
        shimmerLabel
      />,
    );
    const button = screen.getByRole('button', { name: 'Weighing contrast' });
    const mark = button.querySelector('.lc-live-mark');
    const bulb = button.querySelector('.lucide-lightbulb');

    expect(mark).toHaveClass('lc-near-mark', 'is-working');
    expect(mark?.parentElement).toBe(bulb?.parentElement);
    expect(mark?.parentElement).not.toHaveClass('lc-reasoning-slot');
    expect(bulb).toHaveClass('lc-live-glyph');
  });

  it('marks the non-interactive row the same way', () => {
    const { container } = render(<ThinkingLabel label="Thoughts" />);
    expect(container.querySelector('.lucide-lightbulb')?.parentElement).toHaveClass(
      'lc-reasoning-slot',
    );
  });
});
