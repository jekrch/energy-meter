import React from 'react';

interface TabButtonProps {
    children: React.ReactNode;
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
}

export const TabButton = React.memo(function TabButton({ children, active, onClick, icon }: TabButtonProps) {
    return (
        <button
            onClick={onClick}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors duration-150 flex items-center gap-2 ${active
                    ? 'bg-emerald-500/12 text-emerald-300'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
        >
            {icon}
            {children}
        </button>
    );
});