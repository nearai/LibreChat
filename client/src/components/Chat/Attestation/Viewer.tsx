import { useEffect, useMemo, useState } from 'react';
import { RotateCw } from 'lucide-react';
import {
  Button,
  Spinner,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogContent,
  OGDialogDescription,
} from '@librechat/client';
import type { TNearAIReceipt, TNearAIVerificationReport } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import type { TranslationKeys } from '~/hooks/useLocalize';
import { connectVerificationReport, verificationViewerUrl } from './connection';
import { useGetStartupConfig } from '~/data-provider/Endpoints/queries';
import { receiptVerifyLink } from './links';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export default function Viewer({
  model,
  reports,
  receipt,
  pending = false,
  isError = false,
  onVerify,
  verifyLabel,
  description,
  darkMode,
  onClose,
  children,
}: {
  model: string;
  reports?: TNearAIVerificationReport[];
  receipt?: TNearAIReceipt;
  pending?: boolean;
  isError?: boolean;
  onVerify?: () => void;
  verifyLabel?: string;
  description?: string;
  darkMode: boolean;
  onClose: () => void;
  children?: ReactNode;
}) {
  const localize = useLocalize();
  const query = useGetStartupConfig();
  // The dialog portal may mount after this component's first effect.
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const viewerUrl = useMemo(() => {
    if (!query.data?.nearaiVerifyUrl) return;
    try {
      const url = verificationViewerUrl(query.data.nearaiVerifyUrl);
      url.search = new URLSearchParams({
        model,
        darkMode: String(darkMode),
        showHeader: 'false',
      }).toString();
      return url.href;
    } catch {
      return;
    }
  }, [query.data?.nearaiVerifyUrl, model, darkMode]);
  useEffect(() => {
    if (!iframe || !reports?.length || !viewerUrl || pending || isError) return;
    setState('loading');
    try {
      return connectVerificationReport({
        iframe,
        reports,
        viewerUrl,
        onReady: () => setState('ready'),
        onError: () => setState('error'),
        onClose,
      });
    } catch {
      setState('error');
    }
  }, [iframe, reports, viewerUrl, pending, isError, onClose]);

  let status: TranslationKeys = 'com_ui_nearai_viewer_unavailable';
  if (isError) status = 'com_ui_nearai_shield_unavailable';
  else if (!reports?.length && receipt) status = 'com_ui_nearai_verification_legacy';
  else if (query.isError || (query.data && !viewerUrl) || !reports?.length)
    status = 'com_ui_nearai_viewer_unavailable';
  else if (state === 'error') status = 'com_ui_nearai_viewer_error';
  const unavailable = !reports?.length || !viewerUrl || isError || state === 'error';
  const showFrame = !!reports?.length && !!viewerUrl && !pending && !isError;
  const loading = pending || (!isError && query.isLoading) || (showFrame && state === 'loading');
  const link =
    viewerUrl && unavailable && receipt ? receiptVerifyLink(viewerUrl, receipt) : undefined;

  return (
    <OGDialogContent
      className={cn(
        'flex max-h-[85dvh] w-full max-w-xl flex-col overflow-hidden sm:w-[calc(100%-2rem)]',
        showFrame && !loading && state !== 'error' ? 'h-[85dvh] max-h-[900px]' : 'h-[360px]',
      )}
    >
      <OGDialogHeader>
        <OGDialogTitle>{localize('com_ui_nearai_verification_title')}</OGDialogTitle>
        <OGDialogDescription className={loading ? 'sr-only' : undefined}>
          {description ??
            localize(
              onVerify ? 'com_ui_nearai_verification_model' : 'com_ui_nearai_verification_snapshot',
            )}
        </OGDialogDescription>
      </OGDialogHeader>
      {children}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Keep the iframe paintable while its React app completes the handshake. */}
        {loading && (
          <div
            role="status"
            className="bg-surface-dialog absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 px-4 py-6 text-center"
          >
            <div className="bg-surface-secondary rounded-full p-4">
              <Spinner size={32} />
            </div>
            <div className="max-w-full space-y-2">
              <p className="text-text-primary text-sm font-medium">
                {localize(
                  pending ? 'com_ui_nearai_viewer_verifying' : 'com_ui_nearai_viewer_loading',
                )}
              </p>
              <p className="text-text-secondary text-xs break-all">{model}</p>
            </div>
          </div>
        )}
        {!loading && unavailable && (
          <div
            role={isError || state === 'error' ? 'alert' : 'status'}
            className="space-y-3 text-sm"
          >
            <p className="text-text-secondary">{localize(status)}</p>
            <p className="font-mono break-all">{receipt?.completionId ?? model}</p>
            {(query.isError || state === 'error') && (
              <Button
                variant="outline"
                onClick={() => {
                  setAttempt((value) => value + 1);
                  if (query.isError) void query.refetch();
                }}
              >
                {localize('com_ui_nearai_viewer_reload')}
              </Button>
            )}
            {link && (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-link underline"
              >
                {localize('com_ui_nearai_view_details')}
              </a>
            )}
          </div>
        )}
        {showFrame ? (
          <iframe
            key={`${model}:${receipt?.completionId ?? ''}:${attempt}`}
            ref={setIframe}
            hidden={state === 'error'}
            title={localize('com_ui_nearai_verification_title')}
            allow="clipboard-write"
            referrerPolicy="no-referrer"
            onError={() => setState('error')}
            tabIndex={loading ? -1 : 0}
            aria-hidden={loading}
            className="-mx-theme-dialog-x min-h-0 flex-1 border-0 sm:mx-0"
          />
        ) : null}
      </div>
      {onVerify && (
        <div className="border-border-light flex shrink-0 justify-end border-t pt-3">
          <Button variant="ghost" size="sm" disabled={pending} onClick={onVerify}>
            <RotateCw className="size-4" aria-hidden="true" />
            {verifyLabel ?? localize('com_ui_nearai_shield_verify_again')}
          </Button>
        </div>
      )}
    </OGDialogContent>
  );
}
