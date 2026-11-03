import { useState, useId } from 'react';
import { Ellipsis } from 'lucide-react';
import * as Ariakit from '@ariakit/react';
import {
  DropdownPopup,
  TooltipAnchor,
  useMediaQuery,
  chromeIconButtonClasses,
} from '@librechat/client';
import useChatOptions from '~/hooks/Chat/useChatOptions';
import { useLocalize } from '~/hooks';

export default function ExportAndShareMenu({
  isSharedButtonEnabled,
  readOnly = false,
}: {
  isSharedButtonEnabled: boolean;
  readOnly?: boolean;
}) {
  const localize = useLocalize();
  const menuId = useId();
  const [isPopoverActive, setIsPopoverActive] = useState(false);
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const { show, items, hasSharedLink, dialogs } = useChatOptions({
    isSharedButtonEnabled,
    readOnly,
    closeMenu: () => setIsPopoverActive(false),
  });

  if (!show) {
    return null;
  }

  const description = localize(
    hasSharedLink ? 'com_ui_chat_options_link_active' : 'com_ui_chat_options',
  );

  return (
    <>
      <DropdownPopup
        portal={true}
        menuId={menuId}
        focusLoop={true}
        unmountOnHide={true}
        isOpen={isPopoverActive}
        setIsOpen={setIsPopoverActive}
        trigger={
          <TooltipAnchor
            description={description}
            render={
              <Ariakit.MenuButton
                id="export-menu-button"
                aria-label={description}
                className={chromeIconButtonClasses()}
              >
                <Ellipsis
                  className="icon-md text-text-primary"
                  aria-hidden="true"
                  focusable="false"
                />
                {hasSharedLink && (
                  <span
                    className="bg-status-info ring-presentation absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2"
                    data-testid="header-shared-link-indicator"
                    aria-hidden="true"
                  />
                )}
              </Ariakit.MenuButton>
            }
          />
        }
        items={items}
        className={isSmallScreen ? '' : 'absolute top-0 right-0 mt-2'}
      />
      {dialogs}
    </>
  );
}
