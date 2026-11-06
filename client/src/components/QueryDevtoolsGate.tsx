import { Suspense } from 'react';
import { importWithRecovery, lazyWithRecovery } from '~/lib/assets/lazy';

interface QueryDevtoolsConfig {
  enableQueryDevtools?: boolean;
}

interface QueryDevtoolsGateProps {
  config?: QueryDevtoolsConfig;
  isDevelopment?: boolean;
  /** The developer asked for the floating panel (`VITE_QUERY_DEVTOOLS=true`). */
  devOptIn?: boolean;
}

const LazyReactQueryDevtools = lazyWithRecovery(() =>
  importWithRecovery(() => import('@tanstack/react-query-devtools/production')).then(
    ({ ReactQueryDevtools }) => ({ default: ReactQueryDevtools }),
  ),
);

/** Off unless asked for: a development build opts in with `VITE_QUERY_DEVTOOLS=true`, any build
 *  through the server-injected `enableQueryDevtools`. The floating trigger otherwise sits over
 *  the header's own controls. */
export const shouldEnableQueryDevtools = ({
  isDevelopment = import.meta.env.DEV,
  devOptIn = import.meta.env.VITE_QUERY_DEVTOOLS === 'true',
  config = typeof window === 'undefined' ? undefined : window.__LIBRECHAT_CONFIG__,
}: QueryDevtoolsGateProps = {}) =>
  (isDevelopment && devOptIn) || config?.enableQueryDevtools === true;

export default function QueryDevtoolsGate({
  isDevelopment,
  devOptIn,
  config,
}: QueryDevtoolsGateProps = {}) {
  if (!shouldEnableQueryDevtools({ isDevelopment, devOptIn, config })) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <LazyReactQueryDevtools initialIsOpen={false} position="top-right" />
    </Suspense>
  );
}
