import React from 'react';
import { Zap, BarChart2, TrendingUp, FileText } from 'lucide-react';

type LoaderVariant = 'energy' | 'chart' | 'analysis' | 'data';

interface PulseLoaderProps {
  message?: string;
  subMessage?: string;
  variant?: LoaderVariant;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const variantConfig = {
  energy: { icon: Zap, color: 'emerald' },
  chart: { icon: BarChart2, color: 'emerald' },
  analysis: { icon: TrendingUp, color: 'blue' },
  data: { icon: FileText, color: 'purple' },
};

export const PulseLoader: React.FC<PulseLoaderProps> = ({
  message = 'Processing...',
  subMessage = 'This may take a moment',
  variant = 'energy',
  size = 'md',
  className = '',
}) => {
  const { icon: Icon, color } = variantConfig[variant];

  const sizeClasses = {
    sm: { container: 'w-10 h-10', icon: 'w-4 h-4', text: 'text-xs', subtext: 'text-[10px]' },
    md: { container: 'w-16 h-16', icon: 'w-6 h-6', text: 'text-sm', subtext: 'text-xs' },
    lg: { container: 'w-24 h-24', icon: 'w-10 h-10', text: 'text-base', subtext: 'text-sm' },
  };

  const colorClasses = {
    emerald: {
      ring: 'border-emerald-500/30',
      spinner: 'border-t-emerald-400',
      glow: 'bg-emerald-500/20',
      icon: 'text-emerald-400',
    },
    blue: {
      ring: 'border-blue-500/30',
      spinner: 'border-t-blue-400',
      glow: 'bg-blue-500/20',
      icon: 'text-blue-400',
    },
    purple: {
      ring: 'border-purple-500/30',
      spinner: 'border-t-purple-400',
      glow: 'bg-purple-500/20',
      icon: 'text-purple-400',
    },
  };

  const s = sizeClasses[size];
  const c = colorClasses[color];

  return (
    <div className={`flex flex-col items-center justify-center gap-4 p-8 ${className}`}>
      {/* Animated energy rings */}
      <div className={`relative ${s.container}`}>
        {/* Outer pulsing ring */}
        <div
          className={`absolute inset-0 rounded-full border-2 ${c.ring}`}
          style={{
            animation: 'pulseRing 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
          }}
        />
        {/* Secondary pulse ring (offset timing) */}
        <div
          className={`absolute inset-0 rounded-full border-2 ${c.ring}`}
          style={{
            animation: 'pulseRing 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
            animationDelay: '0.5s',
          }}
        />
        {/* Spinning ring */}
        <div
          className={`absolute inset-1 rounded-full border-2 border-transparent ${c.spinner}`}
          style={{
            animation: 'spin 1s linear infinite',
          }}
        />
        {/* Inner glow */}
        <div
          className={`absolute inset-3 rounded-full ${c.glow}`}
          style={{
            animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
          }}
        />
        {/* Center icon */}
        <div className="absolute inset-0 flex items-center justify-center">
          <Icon
            className={`${s.icon} ${c.icon}`}
            style={{
              animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
            }}
          />
        </div>
      </div>

      {/* Text */}
      <div className="text-center">
        <p className={`text-slate-300 font-medium ${s.text}`}>{message}</p>
        {subMessage && (
          <p className={`text-slate-500 mt-1 ${s.subtext}`}>{subMessage}</p>
        )}
      </div>

      {/* Keyframe styles */}
      <style>{`
        @keyframes pulseRing {
          0% {
            transform: scale(1);
            opacity: 0.8;
          }
          50% {
            transform: scale(1.15);
            opacity: 0;
          }
          100% {
            transform: scale(1);
            opacity: 0;
          }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
};

// Overlay version for use over content
interface LoadingOverlayProps extends PulseLoaderProps {
  visible: boolean;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  visible,
  ...loaderProps
}) => {
  if (!visible) return null;

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center overflow-hidden">
      {/* Solid base layer - fully opaque */}
      <div className="absolute inset-0 bg-slate-900" />
      
      {/* Subtle animated gradient for visual interest */}
      <div 
        className="absolute inset-0 opacity-50"
        style={{
          background: 'radial-gradient(circle at 50% 50%, rgba(16, 185, 129, 0.08) 0%, transparent 50%)',
          animation: 'pulseGlow 3s ease-in-out infinite',
        }}
      />
      
      {/* Grid pattern overlay */}
      <div 
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                           linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: '20px 20px',
        }}
      />
      
      {/* Loader content */}
      <div className="relative z-10">
        <PulseLoader {...loaderProps} />
      </div>
      
      <style>{`
        @keyframes pulseGlow {
          0%, 100% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.2); opacity: 0.6; }
        }
      `}</style>
    </div>
  );
};

// Inline status chip with loading state
interface StatusChipProps {
  loading: boolean;
  count: number;
  label?: string;
}

export const StatusChip: React.FC<StatusChipProps> = ({
  loading,
  count,
  label,
}) => (
  <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-800/50 border border-slate-700/30">
    {/* {loading && (
      <div className="relative w-3 h-3">
        <div
          className="absolute inset-0 rounded-full border border-emerald-400/30"
          style={{ animation: 'pulseRing 1.5s ease-out infinite' }}
        />
        <div
          className="absolute inset-0 rounded-full border border-transparent border-t-emerald-400"
          style={{ animation: 'spin 0.8s linear infinite' }}
        />
      </div>
    )} */}
    <span className={`text-[10px] text-slate-400 font-medium ${loading ? 'text-slate-500' : ''}`}>
      {label || count.toLocaleString()}
    </span>
    <style>{`
      @keyframes pulseRing {
        0% { transform: scale(1); opacity: 0.8; }
        100% { transform: scale(1.5); opacity: 0; }
      }
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `}</style>
  </div>
);

export default PulseLoader;