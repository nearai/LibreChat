import { memo, useCallback } from 'react';
import { SquarePen } from 'lucide-react';
import { useShortcutAriaKey } from '~/hooks/useKeyboardShortcuts';
import { useActivePanel, DEFAULT_PANEL } from '~/Providers';
import { useGetStartupConfig } from '~/data-provider';
import useNewChat from '~/hooks/Chat/useNewChat';
import { DEFAULT_APP_TITLE } from '~/utils';
import { useLocalize } from '~/hooks';

/**
 * The sidebar's brand row: the app's name, or the configured mark and wordmark. It sits in the
 * toolbar band on the shell, level with the chat's header, above the panel card.
 */
function Masthead() {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();

  const title = startupConfig?.appTitle || DEFAULT_APP_TITLE;
  const brand = startupConfig?.interface?.brand;
  const wordmark = brand?.wordmark;

  return (
    <div className="flex h-12 min-w-0 shrink-0 items-center gap-2 px-4">
      {brand?.mark && <img src={brand.mark} alt="" className="size-5.5 shrink-0" />}
      {wordmark ? (
        /* One image per mode: the configured wordmark is artwork, not type, so it cannot
           follow the text color the way a title does. */
        <>
          <img
            src={wordmark.light}
            alt={localize('com_ui_logo', { 0: title })}
            className="h-4.5 w-auto min-w-0 dark:hidden"
          />
          <img
            src={wordmark.dark}
            alt={localize('com_ui_logo', { 0: title })}
            className="hidden h-4.5 w-auto min-w-0 dark:block"
          />
        </>
      ) : (
        <p className="text-text-primary truncate text-lg font-semibold">{title}</p>
      )}
    </div>
  );
}

/**
 * The New chat row at the top of the panel card, shared by every panel the rail opens, so
 * starting a chat never depends on which panel is showing.
 */
export const NewChatRow = memo(function NewChatRow({
  switchToHistory,
}: {
  switchToHistory: boolean;
}) {
  const localize = useLocalize();
  const { setActive } = useActivePanel();
  const ariaKey = useShortcutAriaKey('newChat');

  const handlePanelSwitch = useCallback(() => {
    if (switchToHistory) {
      setActive(DEFAULT_PANEL);
    }
  }, [switchToHistory, setActive]);

  const { handleNewChatClick } = useNewChat({ onNewChat: handlePanelSwitch });

  return (
    <div className="shrink-0 px-2 pt-2 pb-1">
      <a
        href="/c/new"
        data-testid="new-chat-button"
        aria-keyshortcuts={ariaKey}
        className="text-text-primary hover:bg-surface-nav-hover focus-visible:ring-ring-primary rounded-theme-control flex h-9 items-center gap-2.5 px-2.5 text-sm outline-hidden transition-colors focus-visible:ring-2"
        onClick={handleNewChatClick}
      >
        <SquarePen className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{localize('com_ui_new_chat')}</span>
      </a>
    </div>
  );
});

export default memo(Masthead);
