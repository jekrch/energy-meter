import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Lightbulb, X, ChevronRight, Clock, Calendar, TrendingUp, Moon, Sun, Snowflake, Flame } from 'lucide-react';
import type { AnalysisFilters } from '../../types';
import type { MetricMode } from '../charts/MainChart';

export interface InsightPreset {
  id: string;
  question: string;
  description: string;
  icon: React.ReactNode;
  category: 'timing' | 'comparison' | 'seasonal';
  filters: Partial<AnalysisFilters>;
  groupBy: 'hour' | 'dayOfWeek' | 'month';
  analysisView: 'averages' | 'timeline';
  metricMode?: MetricMode;
}

const INSIGHT_PRESETS: InsightPreset[] = [
  {
    id: 'peak-hours',
    question: 'When do I use the most energy?',
    description: 'See your average usage by hour to find peak times',
    icon: <Clock className="w-4 h-4" />,
    category: 'timing',
    filters: { daysOfWeek: [], months: [], hourStart: 0, hourEnd: 23 },
    groupBy: 'hour',
    analysisView: 'averages',
  },
  {
    id: 'overnight-baseline',
    question: "What's my overnight baseline?",
    description: 'Usage from midnight to 5 AM when most things are off',
    icon: <Moon className="w-4 h-4" />,
    category: 'timing',
    filters: { daysOfWeek: [], months: [], hourStart: 0, hourEnd: 5 },
    groupBy: 'hour',
    analysisView: 'averages',
  },
  {
    id: 'morning-routine',
    question: 'How much does my morning routine cost?',
    description: 'Energy use from 6–9 AM when you start your day',
    icon: <Sun className="w-4 h-4" />,
    category: 'timing',
    filters: { daysOfWeek: [], months: [], hourStart: 6, hourEnd: 9 },
    groupBy: 'hour',
    analysisView: 'timeline',
    metricMode: 'cost',
  },
  {
    id: 'weekday-vs-weekend',
    question: 'Weekdays vs weekends—any difference?',
    description: 'Compare your daily patterns across the week',
    icon: <Calendar className="w-4 h-4" />,
    category: 'comparison',
    filters: { daysOfWeek: [], months: [], hourStart: 0, hourEnd: 23 },
    groupBy: 'dayOfWeek',
    analysisView: 'averages',
  },
  {
    id: 'weekday-only',
    question: 'What do weekdays look like?',
    description: 'Focus on Monday through Friday patterns',
    icon: <Calendar className="w-4 h-4" />,
    category: 'comparison',
    filters: { daysOfWeek: [1, 2, 3, 4, 5], months: [], hourStart: 0, hourEnd: 23 },
    groupBy: 'hour',
    analysisView: 'averages',
  },
  {
    id: 'weekend-only',
    question: 'What do weekends look like?',
    description: 'Focus on Saturday and Sunday patterns',
    icon: <Calendar className="w-4 h-4" />,
    category: 'comparison',
    filters: { daysOfWeek: [0, 6], months: [], hourStart: 0, hourEnd: 23 },
    groupBy: 'hour',
    analysisView: 'averages',
  },
  {
    id: 'monthly-trend',
    question: 'How has my usage changed over time?',
    description: 'See the big picture month by month',
    icon: <TrendingUp className="w-4 h-4" />,
    category: 'seasonal',
    filters: { daysOfWeek: [], months: [], hourStart: 0, hourEnd: 23 },
    groupBy: 'month',
    analysisView: 'timeline',
  },
  {
    id: 'monthly-cost',
    question: 'Which months cost me the most?',
    description: 'Average monthly costs to spot expensive periods',
    icon: <TrendingUp className="w-4 h-4" />,
    category: 'seasonal',
    filters: { daysOfWeek: [], months: [], hourStart: 0, hourEnd: 23 },
    groupBy: 'month',
    analysisView: 'averages',
    metricMode: 'cost',
  },
  {
    id: 'summer-usage',
    question: 'How much do I use in summer?',
    description: 'June, July, and August usage (cooling season)',
    icon: <Flame className="w-4 h-4" />,
    category: 'seasonal',
    filters: { daysOfWeek: [], months: [5, 6, 7], hourStart: 0, hourEnd: 23 },
    groupBy: 'hour',
    analysisView: 'averages',
  },
  {
    id: 'winter-usage',
    question: 'How much do I use in winter?',
    description: 'December, January, and February (heating season)',
    icon: <Snowflake className="w-4 h-4" />,
    category: 'seasonal',
    filters: { daysOfWeek: [], months: [11, 0, 1], hourStart: 0, hourEnd: 23 },
    groupBy: 'hour',
    analysisView: 'averages',
  },
];

const CATEGORIES = [
  { id: 'timing', label: 'Daily Patterns', description: 'When you use energy' },
  { id: 'comparison', label: 'Comparisons', description: 'Weekdays, weekends & more' },
  { id: 'seasonal', label: 'Trends & Seasons', description: 'Changes over time' },
] as const;

interface InsightsModalProps {
  onSelectInsight: (preset: InsightPreset) => void;
}

export const InsightsModal = React.memo(function InsightsModal({
  onSelectInsight,
}: InsightsModalProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const closeModal = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setIsAnimating(false);
    setTimeout(() => setIsExpanded(false), 150);
  }, []);

  const openModal = useCallback(() => {
    setIsExpanded(true);
    requestAnimationFrame(() => setIsAnimating(true));
  }, []);

  useEffect(() => {
    if (!isExpanded) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        modalRef.current && !modalRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        closeModal();
      }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClickOutside), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isExpanded, closeModal]);

  useEffect(() => {
    if (!isExpanded) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isExpanded, closeModal]);

  const handleSelectInsight = useCallback((preset: InsightPreset) => {
    onSelectInsight(preset);
    closeModal();
  }, [onSelectInsight, closeModal]);

  const modal = isExpanded ? createPortal(
    <div
      className={`fixed inset-0 z-[9998] flex items-start justify-center pt-[10vh] px-4 bg-black/30 backdrop-blur-[2px] transition-opacity duration-150 ${
        isAnimating ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={closeModal}
    >
      <div
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-md max-h-[75vh] flex flex-col transition-all duration-150 ease-out ${
          isAnimating ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-4 scale-95'
        }`}
      >
        <div className="bg-slate-800/95 backdrop-blur-xl border border-slate-700/80 rounded-xl shadow-2xl shadow-black/40 overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-amber-500/10 rounded-lg">
                <Lightbulb className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <span className="text-sm font-medium text-slate-200">Explore Your Data</span>
                <p className="text-[10px] text-slate-500">Click a question to see the answer</p>
              </div>
            </div>
            <button
              onClick={closeModal}
              className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-700/50 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          <div className="overflow-y-auto flex-1 p-3 space-y-4">
            {CATEGORIES.map((category) => (
              <div key={category.id}>
                <div className="px-1 mb-2">
                  <h3 className="text-xs font-medium text-slate-300">{category.label}</h3>
                  <p className="text-[10px] text-slate-500">{category.description}</p>
                </div>
                <div className="space-y-1.5">
                  {INSIGHT_PRESETS.filter((p) => p.category === category.id).map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => handleSelectInsight(preset)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 bg-slate-900/50 hover:bg-slate-700/50 border border-slate-700/50 hover:border-slate-600/50 rounded-lg transition-all group text-left"
                    >
                      <div className="p-1.5 bg-slate-800 group-hover:bg-slate-700 rounded-md text-slate-400 group-hover:text-amber-400 transition-colors flex-shrink-0">
                        {preset.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-200 group-hover:text-white transition-colors">
                          {preset.question}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {preset.description}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 bg-slate-900/40 border-t border-slate-700/30 flex-shrink-0">
            <p className="text-[10px] text-slate-500">
              You can always adjust the filters manually after
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <>
      <button
        ref={buttonRef}
        onClick={openModal}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gradient-to-r from-amber-500/10 to-orange-500/10 text-amber-400/90 hover:text-amber-400 ring-1 ring-amber-500/20 hover:ring-amber-500/40 rounded-lg transition-all"
        title="Explore common questions about your data"
      >
        <Lightbulb className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Explore</span>
      </button>
      {modal}
    </>
  );
});

export { INSIGHT_PRESETS };