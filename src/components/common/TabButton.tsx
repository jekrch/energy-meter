import React from 'react';

interface TabButtonProps {
    children: React.ReactNode;
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    // The tab bar measures its buttons to slide one highlight between them.
    ref?: React.Ref<HTMLButtonElement>;
}

// The selected tab's background is painted by the bar's sliding highlight, not
// by the button, so the two never appear at once.
export const TabButton = React.memo(function TabButton({ children, active, onClick, icon, ref }: TabButtonProps) {
    return (
        <button
            ref={ref}
            onClick={onClick}
            className={`relative px-3 py-1.5 rounded-md text-sm font-medium transition-colors duration-150 flex items-center gap-2 ${active
                    ? 'text-emerald-300'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
        >
            {icon}
            {children}
        </button>
    );
});