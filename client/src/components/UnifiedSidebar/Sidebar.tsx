import { memo } from 'react';
import type { NavLink } from '~/common';
import SidePanelNav from '~/components/SidePanel/Nav';
import Masthead, { NewChatRow } from './Masthead';
import ExpandedPanel from './ExpandedPanel';
import { cn } from '~/utils';

function Sidebar({
  links,
  expanded,
  width,
  minWidth,
  maxWidth,
  onCollapse,
  onExpand,
  onLeaveInsights,
  switchToHistory,
  onResizeStart,
  onResizeKeyboard,
}: {
  links: NavLink[];
  expanded: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
  onCollapse: () => void;
  onExpand: () => void;
  onLeaveInsights: () => void;
  switchToHistory: boolean;
  onResizeStart: (e: React.MouseEvent) => void;
  onResizeKeyboard: (direction: 'shrink' | 'grow') => void;
}) {
  return (
    <>
      <div className="flex h-full w-full overflow-hidden">
        <ExpandedPanel
          links={links}
          expanded={expanded}
          onCollapse={onCollapse}
          onExpand={onExpand}
          onLeaveInsights={onLeaveInsights}
        />
        <nav
          className={cn(
            'my-2 flex min-h-0 flex-1 flex-col overflow-hidden',
            expanded ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
          style={{ transition: expanded ? 'opacity 200ms ease 80ms' : 'opacity 150ms ease' }}
          aria-hidden={!expanded}
        >
          {/* The brand row sits in the toolbar band on the shell, level with the chat's
              header; the panel card starts below it. */}
          <Masthead />
          {/* The leading half of the card that floats on the shell: it rounds the leading
              corners and the chat canvas beside it rounds the trailing ones. The resize
              separator to the right is transparent until hovered, and both halves share one
              surface, so the boundary between them is a line in every theme. */}
          <div className="border-border-light bg-surface-primary-alt rounded-l-theme-surface-lg flex min-h-0 flex-1 flex-col overflow-hidden border-r">
            <NewChatRow switchToHistory={switchToHistory} />
            <div className="min-h-0 flex-1">
              <SidePanelNav links={links} />
            </div>
          </div>
        </nav>
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={Math.round(width)}
        aria-valuemin={Math.round(minWidth)}
        aria-valuemax={Math.round(maxWidth)}
        tabIndex={expanded ? 0 : -1}
        className={cn(
          'hover:bg-border-medium active:bg-border-heavy absolute top-14 right-0 bottom-2 z-10 w-1 cursor-col-resize transition-colors',
          expanded ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        style={{ transition: expanded ? 'opacity 200ms ease 80ms' : 'opacity 150ms ease' }}
        onMouseDown={onResizeStart}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') {
            onResizeKeyboard('shrink');
          } else if (e.key === 'ArrowRight') {
            onResizeKeyboard('grow');
          }
        }}
      />
    </>
  );
}

export default memo(Sidebar);
