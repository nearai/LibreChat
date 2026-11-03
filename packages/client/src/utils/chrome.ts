import { cn } from './utils';

/**
 * An icon-only control in the app's chrome (the chat header's bookmark, share, verification and
 * task buttons). It draws no container at rest, so a row of them reads as glyphs on the canvas;
 * the fill appears only while the control is hovered, pressed or holding its menu open.
 */
export const chromeIconButtonClasses = (): string =>
  cn(
    'relative inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-text-primary',
    'bg-transparent transition-colors duration-theme-fast',
    'hover:bg-surface-hover active:bg-surface-active-alt aria-expanded:bg-surface-active-alt',
    'disabled:pointer-events-none disabled:opacity-50',
  );
