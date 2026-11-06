import React from 'react';
import { renderHook } from '@testing-library/react';
import { EModelEndpoint } from 'librechat-data-provider';
import type { TEndpointsConfig } from 'librechat-data-provider';
import CustomIcon from '~/components/ui/CustomIcon';
import { useEndpoints } from '../useEndpoints';

jest.mock('librechat-data-provider/react-query', () => ({
  useGetModelsQuery: () => ({ data: { 'NEAR AI': ['Qwen/Qwen3.6-35B-A3B-FP8'] } }),
}));

jest.mock('~/data-provider', () => ({
  useGetEndpointsQuery: () => ({ data: ['NEAR AI'] }),
}));

jest.mock('~/hooks', () => ({
  useHasAccess: () => true,
  useShowMarketplace: () => false,
}));

const endpointsConfig: TEndpointsConfig = {
  'NEAR AI': { type: EModelEndpoint.custom, iconURL: '/assets/nearai-chat.svg', order: 0 },
};

/** The model selector's trigger and its endpoint rows draw this icon on the control surface, so a
 *  one-ink mark has to follow the text color rather than keep its own (black) ink. */
describe('useEndpoints endpoint icon', () => {
  it('draws an image icon through CustomIcon, which tints a one-ink SVG to the text color', () => {
    const { result } = renderHook(() =>
      useEndpoints({ endpointsConfig, startupConfig: undefined }),
    );

    const icon = result.current.mappedEndpoints[0].icon;
    expect(React.isValidElement(icon)).toBe(true);
    const element = icon as React.ReactElement<{ src: string; className: string }>;
    expect(element.type).toBe(CustomIcon);
    expect(element.props.src).toBe('/assets/nearai-chat.svg');
    expect(element.props.className).toContain('text-text-primary');
  });
});
