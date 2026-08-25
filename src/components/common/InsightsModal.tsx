import React, { useState, useRef, useCallback } from 'react';
import { Modal, type ModalHandle } from './Modal';
import { Lightbulb, X, ChevronRight, Clock, Calendar, TrendingUp, Moon, Sun, Snowflake, Flame, ListOrdered } from 'lucide-react';
import type { AnalysisFilters, DataPoint } from '../../types';
import type { MetricMode } from '../charts/MainChart';
import type { HourlyWeatherData } from '../../utils/weatherData';
import type { EnergyUnit } from '../../utils/energyUnits';
import type { RankingEntry } from '../../utils/rankings';
import { TopRankings } from './TopRankings';
import { usePersistentState } from '../../hooks/usePersistentState';

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
    filters: { daysOfWeek: [], months: [], hourRanges: [{ start: 0, end: 23 }] },
    groupBy: 'hour',
    analysisView: 'averages',
  },
  {
    id: 'overnight-baseline',
    question: "What's my overnight baseline?",
    description: 'Usage from midnight to 5 AM when most things are off',
    icon: <Moon className="w-4 h-4" />,
    category: 'timing',
    filters: { daysOfWeek: [], months: [], hourRanges: [{ start: 0, end: 5 }] },
    groupBy: 'dayOfWeek',
    analysisView: 'averages',
  },
  {
    id: 'morning-routine',
    question: 'How much does my morning routine cost?',
    description: 'Energy use from 6–9 AM when you start your day',
    icon: <Sun className="w-4 h-4" />,
    category: 'timing',
    filters: { daysOfWeek: [], months: [], hourRanges: [{ start: 6, end: 9 }] },
    groupBy: 'dayOfWeek',
    analysisView: 'averages',
    metricMode: 'cost',
  },
  {
    id: 'weekday-vs-weekend',
    question: 'Weekdays vs weekends: any difference?',
    description: 'Compare your daily patterns across the week',
    icon: <Calendar className="w-4 h-4" />,
    category: 'comparison',
    filters: { daysOfWeek: [], months: [], hourRanges: [{ start: 0, end: 23 }] },
    groupBy: 'dayOfWeek',
    analysisView: 'averages',
  },
  {
    id: 'weekday-only',
    question: 'What do weekdays look like?',
    description: 'Focus on Monday through Friday patterns',
    icon: <Calendar className="w-4 h-4" />,
    category: 'comparison',
    filters: { daysOfWeek: [1, 2, 3, 4, 5], months: [], hourRanges: [{ start: 0, end: 23 }] },
    groupBy: 'hour',
    analysisView: 'averages',
  },
  {
    id: 'weekend-only',
    question: 'What do weekends look like?',
    description: 'Focus on Saturday and Sunday patterns',
    icon: <Calendar className="w-4 h-4" />,
    category: 'comparison',
    filters: { daysOfWeek: [0, 6], months: [], hourRanges: [{ start: 0, end: 23 }] },
    groupBy: 'hour',
    analysisView: 'averages',
  },
  {
    id: 'monthly-trend',
    question: 'How has my usage changed over time?',
    description: 'See the big picture month by month',
    icon: <TrendingUp className="w-4 h-4" />,
    category: 'seasonal',
    filters: { daysOfWeek: [], months: [], hourRanges: [{ start: 0, end: 23 }] },
    groupBy: 'month',
    analysisView: 'timeline',
  },
  {
    id: 'monthly-cost',
    question: 'Which months cost me the most?',
    description: 'Average monthly costs to spot expensive periods',
    icon: <TrendingUp className="w-4 h-4" />,
    category: 'seasonal',
    filters: { daysOfWeek: [], months: [], hourRanges: [{ start: 0, end: 23 }] },
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
    filters: { daysOfWeek: [], months: [5, 6, 7], hourRanges: [{ start: 0, end: 23 }] },
    groupBy: 'dayOfWeek',
    analysisView: 'averages',
  },
  {
    id: 'winter-usage',
    question: 'How much do I use in winter?',
    description: 'December, January, and February (heating season)',
    icon: <Snowflake className="w-4 h-4" />,
    category: 'seasonal',
    filters: { daysOfWeek: [], months: [11, 0, 1], hourRanges: [{ start: 0, end: 23 }] },
    groupBy: 'dayOfWeek',
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
  onViewRanking: (entry: RankingEntry) => void;
  data: DataPoint[];
  weather: HourlyWeatherData[];
  hasTemperature: boolean;
  energyUnit: EnergyUnit;
  temperatureUnit: 'C' | 'F';
  children?: (openModal: () => void) => React.ReactNode;
}

type ModalTab = 'insights' | 'rankings';

export const InsightsModal = React.memo(function InsightsModal({
  onSelectInsight,
  onViewRanking,
  data,
  weather,
  hasTemperature,
  energyUnit,
  temperatureUnit,
  children,
}: InsightsModalProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [tab, setTab] = usePersistentState<ModalTab>('gb-insights-tab', 'insights');
  const modalRef = useRef<ModalHandle>(null);

  const closeModal = useCallback(() => setIsExpanded(false), []);
  const openModal = useCallback(() => setIsExpanded(true), []);

  const handleSelectInsight = useCallback((preset: InsightPreset) => {
    modalRef.current?.close(() => {
      onSelectInsight(preset);
      setIsExpanded(false);
    });
  }, [onSelectInsight]);

  const handleViewRanking = useCallback((entry: RankingEntry) => {
    modalRef.current?.close(() => {
      onViewRanking(entry);
      setIsExpanded(false);
    });
  }, [onViewRanking]);

  const modal = isExpanded ? (
    <Modal
      ref={modalRef}
      onClose={closeModal}
      overlayClassName="pt-[10vh] bg-black/30 backdrop-blur-[2px]"
      panelClassName="max-w-lg md:max-w-xl max-h-[75vh]"
      ariaLabel="Explore your data"
    >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-header-line flex-shrink-0">
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
              onClick={() => modalRef.current?.close()}
              className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-white/5 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 px-3 pt-3 flex-shrink-0">
            <button
              onClick={() => setTab('insights')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                tab === 'insights'
                  ? 'bg-surface-3 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              <Lightbulb className="w-3.5 h-3.5" />
              Guided Insights
            </button>
            <button
              onClick={() => setTab('rankings')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                tab === 'rankings'
                  ? 'bg-surface-3 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              <ListOrdered className="w-3.5 h-3.5" />
              Top Rankings
            </button>
          </div>

          {/* Content */}
          <div className="overflow-y-auto flex-1 p-3 space-y-4">
            {tab === 'rankings' ? (
              <TopRankings
                data={data}
                weather={weather}
                hasTemperature={hasTemperature}
                energyUnit={energyUnit}
                temperatureUnit={temperatureUnit}
                onViewRanking={handleViewRanking}
              />
            ) : (
            CATEGORIES.map((category) => (
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
                      className="w-full flex items-center gap-3 px-3 py-2.5 bg-surface-2 hover:bg-surface-3 border border-line hover:border-line-2 rounded-lg transition-colors group text-left"
                    >
                      <div className="p-1.5 bg-surface-3 group-hover:bg-white/10 rounded-md text-slate-400 group-hover:text-amber-400 transition-colors flex-shrink-0">
                        {preset.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-200 group-hover:text-white transition-colors">
                          {preset.question}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {preset.description}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 group-hover:translate-x-0.5 transition-[color,transform] duration-150 flex-shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            ))
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 bg-sunken border-t border-header-line flex-shrink-0">
            <p className="text-[10px] text-slate-500">
              You can always adjust the filters manually after
            </p>
          </div>
    </Modal>
  ) : null;

  // If children render prop is provided, use it for custom trigger
  if (children) {
    return (
      <>
        {children(openModal)}
        {modal}
      </>
    );
  }

  // Default trigger button
  return (
    <>
      <button
        onClick={openModal}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gradient-to-r from-amber-500/10 to-orange-500/10 text-amber-400/90 hover:text-amber-400 ring-1 ring-amber-500/20 hover:ring-amber-500/40 rounded-lg transition-colors"
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