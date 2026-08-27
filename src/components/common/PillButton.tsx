import React, { createContext, useContext, useLayoutEffect, useMemo, useState } from 'react';
import {
  useSlidingHighlight, highlightStyle, SLIDING_HIGHLIGHT_CLASS,
} from '../../hooks/useSlidingHighlight';

// Shared "segmented control" primitives. The pill-button pattern (a bordered
// pill container holding small toggle buttons with an active/inactive state) was
// copy-pasted across the chart toolbar and the export modal; these centralize
// the structural classes so only the per-use bits (layout + active color) vary.

interface PillGroupContextValue {
  activeId: string;
  registerItem: (id: string, el: HTMLElement | null) => void;
  // Lets the selected pill hand its own accent to the travelling highlight, so
  // groups whose selections differ in colour (cost / energy / demand) tween
  // between them instead of the caller repeating the colour map here.
  setHighlightSurface: (classes: string) => void;
}

const PillGroupContext = createContext<PillGroupContextValue | null>(null);

// Classes that paint the pill's own box, as opposed to its label. When a group
// slides, these move onto the highlight and the button keeps only its colour.
const SURFACE_PREFIXES = ['bg-', 'border-', 'ring-', 'shadow-'];

function splitActiveClasses(activeClassName: string) {
  const parts = activeClassName.split(/\s+/).filter(Boolean);
  const isSurface = (part: string) => SURFACE_PREFIXES.some((prefix) => part.startsWith(prefix));
  return {
    surface: parts.filter(isSurface).join(' '),
    label: parts.filter((part) => !isSurface(part)).join(' '),
  };
}

interface PillGroupProps {
  // Caller supplies the background + rounding variant, e.g.
  // "bg-sunken rounded-lg". Everything else is fixed.
  className?: string;
  /**
   * Id of the selected pill. Setting it (and giving each PillButton a matching
   * `id`) swaps the selected pill's own background for one highlight that
   * slides between pills. Only for groups where something is always selected —
   * a group that can have nothing selected would leave the highlight stranded
   * on the last selection.
   */
  activeId?: string;
  // Rounding for the sliding highlight; match the pills' own rounding.
  highlightClassName?: string;
  children: React.ReactNode;
}

export function PillGroup({
  className = '',
  activeId,
  highlightClassName = 'rounded-md',
  children,
}: PillGroupProps) {
  const sliding = activeId !== undefined;
  const strip = useSlidingHighlight(activeId ?? '', [React.Children.count(children)]);
  const [surface, setSurface] = useState('');

  const { containerRef, setItemRef } = strip;
  const context = useMemo<PillGroupContextValue | null>(
    () => (activeId === undefined ? null : {
      activeId,
      registerItem: (id, el) => setItemRef(id)(el),
      setHighlightSurface: setSurface,
    }),
    [activeId, setItemRef],
  );

  return (
    <div ref={containerRef} className={`relative flex p-0.5 border border-line ${className}`}>
      {/* One highlight that slides to the picked pill rather than blinking off
          one and on the next. It sits behind them; pills paint no background of
          their own while a group slides. */}
      {sliding && strip.rect && surface && (
        <div
          aria-hidden
          className={`${SLIDING_HIGHLIGHT_CLASS} ${highlightClassName} ${surface}`}
          style={highlightStyle(strip.rect)}
        />
      )}
      <PillGroupContext.Provider value={context}>
        {children}
      </PillGroupContext.Provider>
    </div>
  );
}

interface PillButtonProps {
  // Matches the group's `activeId` when this pill is the selected one. Only
  // needed in a sliding group.
  id?: string;
  active: boolean;
  onClick: () => void;
  // Classes applied when active (typically the accent color), e.g.
  // "bg-emerald-500/15 text-emerald-400". Active pills use color, not shadow —
  // elevation is reserved for floating surfaces (see --shadow-float).
  activeClassName: string;
  inactiveClassName?: string;
  // Per-use layout: padding, text size, rounding, flex, gap.
  className?: string;
  disabled?: boolean;
  // Hover text, for pills whose label is hidden on small screens.
  title?: string;
  children: React.ReactNode;
}

export function PillButton({
  id,
  active,
  onClick,
  activeClassName,
  inactiveClassName = 'text-slate-400 hover:text-slate-200',
  className = '',
  disabled = false,
  title,
  children,
}: PillButtonProps) {
  const group = useContext(PillGroupContext);
  const tracked = group !== null && id !== undefined;
  const { surface, label } = useMemo(() => splitActiveClasses(activeClassName), [activeClassName]);

  // Before paint, so the highlight is already wearing this pill's accent by the
  // time it starts travelling.
  useLayoutEffect(() => {
    if (tracked && active) group.setHighlightSurface(surface);
  }, [tracked, active, surface, group]);

  const activeClasses = tracked ? label : activeClassName;

  return (
    <button
      ref={tracked ? (el) => group.registerItem(id, el) : undefined}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`relative font-medium transition-colors duration-150 ${className} ${active ? activeClasses : inactiveClassName}${disabled ? ' pointer-events-none' : ''}`}
    >
      {children}
    </button>
  );
}
