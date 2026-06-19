import { useState, useRef, useEffect, useCallback } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface DropdownOption<T extends string = string> {
  value: T;
  label: string;
}

interface DropdownProps<T extends string = string> {
  options: DropdownOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

export function Dropdown<T extends string = string>({
  options,
  value,
  onChange,
  disabled = false,
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuAbove, setMenuAbove] = useState(false);

  const selectedLabel = options.find(o => o.value === value)?.label ?? '';

  const toggle = useCallback(() => {
    if (disabled) return;
    setOpen(prev => !prev);
  }, [disabled]);

  // Position the menu above or below depending on viewport space
  useEffect(() => {
    if (!open || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const menuHeight = options.length * 36 + 8; // estimate
    setMenuAbove(spaceBelow < menuHeight && rect.top > menuHeight);
  }, [open, options.length]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        className={`w-full flex items-center justify-between bg-sunken border border-line rounded-lg px-3 py-2.5 text-sm text-left transition-colors focus-visible:outline-none ${
          open
            ? 'ring-2 ring-emerald-500/40 border-emerald-500/50'
            : 'hover:border-line-2 focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/50'
        } ${disabled ? 'pointer-events-none opacity-60' : ''}`}
      >
        <span className="text-slate-200 truncate">{selectedLabel}</span>
        <ChevronDown
          className={`w-4 h-4 text-slate-500 flex-shrink-0 ml-2 transition-transform duration-150 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Menu */}
      {open && (
        <div
          ref={menuRef}
          className={`absolute z-50 left-0 right-0 bg-surface-2 border border-line-2 rounded-lg shadow-float py-1 ${
            menuAbove ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
          style={{ animation: 'dropdown-enter 120ms ease-out' }}
        >
          {options.map(opt => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${
                  isSelected
                    ? 'text-emerald-400 bg-emerald-500/10'
                    : 'text-slate-300 hover:bg-white/5 hover:text-slate-100'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 ${
                    isSelected
                      ? 'bg-emerald-500/20 border border-emerald-500/50'
                      : 'border border-transparent'
                  }`}
                >
                  {isSelected && <Check className="w-3 h-3 text-emerald-400" />}
                </div>
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Keyframe animation — injected once */}
      <style>{`
        @keyframes dropdown-enter {
          from { opacity: 0; transform: translateY(-4px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)   scale(1); }
        }
      `}</style>
    </div>
  );
}