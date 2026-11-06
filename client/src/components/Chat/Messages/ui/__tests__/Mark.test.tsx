import React from 'react';
import { render } from '@testing-library/react';
import { DrawnMark, ProcessMark, WaitMark } from '../Mark';

describe('ProcessMark', () => {
  it('draws the solid mark at rest, with no light to chase', () => {
    const { container } = render(<ProcessMark />);
    const svg = container.querySelector('svg');

    expect(svg).toHaveClass('lc-near-mark');
    expect(svg).not.toHaveClass('is-working');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.lc-near-mark-base')).not.toBeNull();
    expect(container.querySelector('.lc-near-mark-light')).toBeNull();
    expect(container.querySelector('clipPath')).toBeNull();
  });

  it('chases a light along the spine, clipped to the letter, while working', () => {
    const { container } = render(<ProcessMark working />);
    const clip = container.querySelector('clipPath');
    const light = container.querySelector('.lc-near-mark-light');

    expect(container.querySelector('svg')).toHaveClass('is-working');
    expect(clip).not.toBeNull();
    expect(light?.parentElement).toHaveAttribute('clip-path', `url(#${clip?.id})`);
  });

  it('gives each working mark its own clip, so two on one page do not share one', () => {
    const { container } = render(
      <>
        <ProcessMark working />
        <ProcessMark working />
      </>,
    );
    const ids = Array.from(container.querySelectorAll('clipPath')).map((clip) => clip.id);

    expect(new Set(ids).size).toBe(2);
  });
});

describe('WaitMark', () => {
  /** It goes beside the waiting dot's span, so the dot keeps the empty last-child position its
   *  style needs, and only the root attribute decides which of the two shows. */
  it('is a working mark that a non-NEAR brand never shows', () => {
    const { container } = render(
      <p className="submitting relative">
        <WaitMark />
        <span className="result-thinking" />
      </p>,
    );
    const mark = container.querySelector('svg');

    expect(mark).toHaveClass('lc-live-mark', 'is-working', 'absolute');
    expect(container.querySelector('.result-thinking')).toBe(
      container.querySelector('p')?.lastChild,
    );
  });
});

describe('DrawnMark', () => {
  /** The pen inks the mark in: the mark is filled only where the marker's stroke has reached, so
   *  the mask's stroke is the whole drawing. Its length is normalized, so style.css can run the
   *  dash from just past the start back to it without knowing the line's length. */
  it('reveals the mark through a marker stroke along its center line', () => {
    const { container } = render(<DrawnMark />);
    const svg = container.querySelector('svg');
    const mask = container.querySelector('mask');
    const ink = container.querySelector('.lc-drawn-mark-ink');
    const mark = container.querySelector(`path[mask="url(#${mask?.id})"]`);

    expect(svg).toHaveClass('lc-drawn-mark');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(mark).toHaveAttribute('fill', 'currentColor');
    expect(ink?.parentElement).toBe(mask);
    expect(ink).toHaveAttribute('d', 'M167.5 234.6L101 312L101 86L299 320L299 84L226 170');
    expect(ink).toHaveAttribute('pathLength', '1');
    expect(ink).toHaveAttribute('stroke-width', '44');
    expect(ink).toHaveAttribute('stroke-linecap', 'round');
  });

  it('keeps the light band inside the mark and the pen tip on top of it', () => {
    const { container } = render(<DrawnMark />);
    const clip = container.querySelector('clipPath');
    const shine = container.querySelector('.lc-drawn-mark-shine');
    const tip = container.querySelector('.lc-drawn-mark-tip');

    expect(shine?.parentElement).toHaveAttribute('clip-path', `url(#${clip?.id})`);
    expect(tip?.tagName.toLowerCase()).toBe('circle');
    expect(container.querySelector('svg')?.lastElementChild).toBe(tip);
  });

  it('gives each mark its own mask and clip', () => {
    const { container } = render(
      <>
        <DrawnMark />
        <DrawnMark />
      </>,
    );
    const ids = Array.from(container.querySelectorAll('mask, clipPath')).map((def) => def.id);

    expect(new Set(ids).size).toBe(4);
  });
});
