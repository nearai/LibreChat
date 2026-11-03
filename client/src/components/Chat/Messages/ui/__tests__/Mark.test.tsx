import React from 'react';
import { render } from '@testing-library/react';
import { ProcessMark } from '../Mark';

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
