import { memo, useCallback, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { Skeleton, Sidebar, TooltipAnchor, chromeIconButtonClasses } from '@librechat/client';
import type { NavLink } from '~/common';
import { useShortcutAriaKey, useShortcutHint } from '~/hooks/useKeyboardShortcuts';
import AgentMarketplaceButton from '~/components/Nav/AgentMarketplaceButton';
import { CLOSE_SIDEBAR_ID } from '~/components/Chat/Menus/OpenSidebar';
import { useActivePanel, resolveActivePanel } from '~/Providers';
import { lazyWithRecovery } from '~/lib/assets/lazy';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const AccountSettings = lazyWithRecovery(() => import('~/components/Nav/AccountSettings'));

const NavIconButton = memo(function NavIconButton({
  link,
  isActive,
  expanded,
  setActive,
  onExpand,
  onCollapse,
  onNavigate,
  onLeaveInsights,
}: {
  link: NavLink;
  isActive: boolean;
  expanded: boolean;
  setActive: (id: string) => void;
  onExpand?: () => void;
  onCollapse?: () => void;
  onNavigate?: () => void;
  onLeaveInsights?: () => void;
}) {
  const localize = useLocalize();

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (link.onClick) {
        link.onClick(e);
        onNavigate?.();
        return;
      }
      if (isActive && expanded) {
        onCollapse?.();
        return;
      }
      if (!isActive) {
        setActive(link.id);
      }
      if (!expanded) {
        onExpand?.();
      } else {
        onLeaveInsights?.();
      }
    },
    [link, isActive, setActive, expanded, onExpand, onCollapse, onNavigate, onLeaveInsights],
  );

  return (
    <TooltipAnchor
      description={localize(link.title)}
      side="right"
      render={
        <button
          type="button"
          aria-label={localize(link.title)}
          aria-pressed={isActive}
          disabled={link.disabled}
          data-testid={`nav-panel-${link.id}`}
          className={cn(
            chromeIconButtonClasses(),
            /* The destination open in the panel keeps the selection fill; the rest show a
               container only under the pointer. */
            isActive
              ? 'bg-surface-nav-selected hover:bg-surface-nav-selected'
              : 'text-text-secondary hover:text-text-primary',
          )}
          onClick={handleClick}
        >
          <link.icon className="h-5 w-5" aria-hidden="true" />
        </button>
      }
    />
  );
});

function ExpandedPanel({
  links,
  expanded = true,
  onCollapse,
  onExpand,
  onNavigate,
  onLeaveInsights,
}: {
  links: NavLink[];
  expanded?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
  onNavigate?: () => void;
  onLeaveInsights?: () => void;
}) {
  const localize = useLocalize();
  const location = useLocation();
  const { active, setActive } = useActivePanel();
  const effectiveActive = resolveActivePanel(active, links);
  const isInsightsRoute = location.pathname.startsWith('/insights');

  const toggleLabel = expanded ? 'com_nav_close_sidebar' : 'com_nav_open_sidebar';
  const toggleClick = expanded ? onCollapse : onExpand;
  const toggleSidebarHint = useShortcutHint('toggleSidebar', localize(toggleLabel));
  const toggleSidebarAriaKey = useShortcutAriaKey('toggleSidebar');

  return (
    /** The rail sits on the shell itself, outside the pane, so it draws no edge of its own. Its
     *  toggle centres on the toolbar band (8 inset, 48 tall) that the brand row and header share. */
    <div className="bg-surface-shell flex h-full shrink-0 flex-col items-center gap-1 px-2 pt-3.5 pb-2">
      <TooltipAnchor
        side="right"
        description={toggleSidebarHint}
        render={
          <button
            type="button"
            id={expanded ? CLOSE_SIDEBAR_ID : undefined}
            data-testid={expanded ? 'close-sidebar-button' : 'open-sidebar-button'}
            aria-label={localize(toggleLabel)}
            aria-expanded={expanded}
            aria-keyshortcuts={toggleSidebarAriaKey}
            /* `aria-expanded` here says the panel is open, not that a menu is: the open panel
               itself shows that, so the toggle keeps the quiet rest state either way. */
            className={cn(
              chromeIconButtonClasses(),
              'text-text-secondary hover:text-text-primary aria-expanded:hover:bg-surface-hover aria-expanded:bg-transparent',
            )}
            onClick={toggleClick}
          >
            <Sidebar aria-hidden="true" className="h-5 w-5" />
          </button>
        }
      />
      <div className="mt-2 flex flex-col items-center gap-1 overflow-y-auto">
        {links.map((link) => (
          <NavIconButton
            key={link.id}
            link={link}
            isActive={
              link.id === 'insights'
                ? isInsightsRoute
                : !isInsightsRoute && link.id === effectiveActive
            }
            expanded={expanded ?? true}
            setActive={setActive}
            onExpand={onExpand}
            onCollapse={onCollapse}
            onNavigate={onNavigate}
            onLeaveInsights={isInsightsRoute ? onLeaveInsights : undefined}
          />
        ))}
        <AgentMarketplaceButton />
      </div>

      <div className="mt-auto">
        <Suspense fallback={<Skeleton className="h-9 w-9 rounded-lg" />}>
          <AccountSettings collapsed />
        </Suspense>
      </div>
    </div>
  );
}

export default memo(ExpandedPanel);
