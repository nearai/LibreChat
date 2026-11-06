import useScaledMaxWidth from '~/hooks/useScaledMaxWidth';
import { PHONE_MAX_WIDTH } from '~/utils/breakpoints';

/**
 * Whether the viewport is phone-sized (`PHONE_MAX_WIDTH`). The header and the composer both read
 * it, so the model picker is in exactly one of them at every width.
 */
export default function usePhoneViewport(): boolean {
  return useScaledMaxWidth(PHONE_MAX_WIDTH);
}
