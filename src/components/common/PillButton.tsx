import React from 'react';

// Shared "segmented control" primitives. The pill-button pattern (a bordered
// pill container holding small toggle buttons with an active/inactive state) was
// copy-pasted across the chart toolbar and the export modal; these centralize
// the structural classes so only the per-use bits (layout + active color) vary.

interface PillGroupProps {
  // Caller supplies the background + rounding variant, e.g.
  // "bg-slate-800/80 rounded-lg". Everything else is fixed.
  className?: string;
  children: React.ReactNode;
}

export function PillGroup({ className = '', children }: PillGroupProps) {
  return (
    <div className={`flex p-0.5 border border-slate-700/50 ${className}`}>
      {children}
    </div>
  );
}

interface PillButtonProps {
  active: boolean;
  onClick: () => void;
  // Classes applied when active (typically the accent color), e.g.
  // "bg-emerald-500/15 text-emerald-400 shadow-sm".
  activeClassName: string;
  inactiveClassName?: string;
  // Per-use layout: padding, text size, rounding, flex, gap.
  className?: string;
  disabled?: boolean;
  children: React.ReactNode;
}

export function PillButton({
  active,
  onClick,
  activeClassName,
  inactiveClassName = 'text-slate-400 hover:text-slate-200',
  className = '',
  disabled = false,
  children,
}: PillButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`font-medium transition-all ${className} ${active ? activeClassName : inactiveClassName}${disabled ? ' pointer-events-none' : ''}`}
    >
      {children}
    </button>
  );
}
