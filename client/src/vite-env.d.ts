/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_LOGGER: string;
  /** `true` shows the React Query devtools in a development build. */
  readonly VITE_QUERY_DEVTOOLS?: string;
  readonly VITE_LOGGER_FILTER: string;
  readonly VITE_FLAT_THREAD: string;
  // Add other env variables here
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
