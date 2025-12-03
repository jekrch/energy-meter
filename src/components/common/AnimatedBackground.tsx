import React from 'react';

export function AnimatedBackground({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-slate-950 overflow-hidden">
      {/* Animated gradient orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {/* Primary emerald orb - slow drift */}
        <div 
          className="absolute w-[800px] h-[800px] rounded-full opacity-[0.10]"
          style={{
            background: 'radial-gradient(circle, rgb(16, 185, 129) 0%, transparent 70%)',
            top: '-200px',
            right: '-200px',
            animation: 'drift1 25s ease-in-out infinite',
          }}
        />
        
        {/* Secondary blue orb */}
        <div 
          className="absolute w-[600px] h-[600px] rounded-full opacity-[0.1]"
          style={{
            background: 'radial-gradient(circle, rgb(59, 130, 246) 0%, transparent 70%)',
            bottom: '-150px',
            left: '-150px',
            animation: 'drift2 30s ease-in-out infinite',
          }}
        />
        
        {/* Tertiary amber accent */}
        <div 
          className="absolute w-[500px] h-[500px] rounded-full opacity-[0.06]"
          style={{
            background: 'radial-gradient(circle, rgb(251, 191, 36) 0%, transparent 70%)',
            top: '40%',
            left: '30%',
            animation: 'drift3 35s ease-in-out infinite',
          }}
        />
        
        {/* Subtle grid overlay for texture */}
        <div 
          className="absolute inset-0 opacity-[0.1]"
          style={{
            backgroundImage: `
              linear-gradient(rgba(16, 185, 129, 0.3) 1px, transparent 1px),
              linear-gradient(90deg, rgba(16, 185, 129, 0.3) 1px, transparent 1px)
            `,
            backgroundSize: '60px 60px',
          }}
        />
      </div>
      
      {/* Content */}
      <div className="relative z-10">
        {children}
      </div>
      
      {/* CSS Keyframes - add to your global styles or a style tag */}
      <style>{`
        @keyframes drift1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          25% { transform: translate(-30px, 20px) scale(1.05); }
          50% { transform: translate(-20px, 40px) scale(0.95); }
          75% { transform: translate(20px, 20px) scale(1.02); }
        }
        
        @keyframes drift2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(40px, -30px) scale(1.08); }
          66% { transform: translate(20px, -50px) scale(0.92); }
        }
        
        @keyframes drift3 {
          0%, 100% { transform: translate(0, 0) scale(1) rotate(0deg); }
          50% { transform: translate(60px, -40px) scale(1.1) rotate(10deg); }
        }
        
        @keyframes pulse-glow {
          0%, 100% { opacity: 0.03; }
          50% { opacity: 0.06; }
        }
      `}</style>
    </div>
  );
}
