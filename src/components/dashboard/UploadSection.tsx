import React, { useLayoutEffect, useRef, useState } from 'react';
import {
    Upload, FileText, AlertCircle, Info, ChevronDown,
    Download, Lock, Github, ExternalLink, User, Scissors, Zap, Building2, History,
} from 'lucide-react';
import {
    useSlidingHighlight, highlightStyle, SLIDING_HIGHLIGHT_CLASS,
} from '../../hooks/useSlidingHighlight';

const INFO_TABS = [
    { id: 'format', label: 'How to get it' },
    { id: 'privacy', label: 'Privacy' },
] as const;

type InfoTab = typeof INFO_TABS[number]['id'];

// Same expo-out curve as `.rise-in`, so the panel settles like the rest of the card.
const EASE_OUT_EXPO = 'ease-[cubic-bezier(0.16,1,0.3,1)]';

interface UploadSectionProps {
    onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onLoadSample: () => void;
    onShowHistory?: () => void;
    historyCount?: number;
    loading: boolean;
    error: string | null;
}

export const UploadSection = React.memo(function UploadSection({ onUpload, onLoadSample, onShowHistory, historyCount = 0, loading, error }: UploadSectionProps) {
    const [showInfo, setShowInfo] = useState(false);
    const [activeTab, setActiveTab] = useState<InfoTab>('format');
    const tabStrip = useSlidingHighlight(activeTab);

    // The panes are stacked in one grid cell so they can cross-fade; the
    // wrapper's height tweens to whichever is active rather than snapping
    // between the tall "how to" pane and the short privacy one.
    const paneRefs = useRef<Partial<Record<InfoTab, HTMLDivElement | null>>>({});
    const [paneHeight, setPaneHeight] = useState<number>();

    useLayoutEffect(() => {
        const el = paneRefs.current[activeTab];
        if (!el) return;
        const measure = () => setPaneHeight(el.offsetHeight);
        measure();
        // Text rewraps when the card narrows — follow it.
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [activeTab]);

    const paneClass = (id: InfoTab) => {
        if (id === activeTab) return `opacity-100 translate-x-0 duration-300 ${EASE_OUT_EXPO}`;
        // Exit toward the side the tab sits on, so the motion follows the strip.
        const side = INFO_TABS.findIndex(t => t.id === id) < INFO_TABS.findIndex(t => t.id === activeTab)
            ? '-translate-x-6'
            : 'translate-x-6';
        return `opacity-0 pointer-events-none ${side} duration-150 ease-out`;
    };

    return (
        <div className="max-w-xl mx-auto mt-0 pb-12">
            <div className="rise-in bg-surface rounded-2xl border border-line p-8 text-center transition-colors duration-300">
                <div className="rise-in relative w-20 h-20 mx-auto mb-6">
                    {/* expanding electric halo — two staggered rings, start after the entrance settles */}
                    <span className="energy-ping absolute inset-0 rounded-full ring-1 ring-emerald-500/50" style={{ animationDelay: '600ms' }} />
                    <span className="energy-ping absolute inset-0 rounded-full ring-1 ring-emerald-500/50" style={{ animationDelay: '1100ms' }} />
                    {/* icon well */}
                    <div className="relative w-20 h-20 rounded-full bg-surface-3 flex items-center justify-center ring-1 ring-line-2">
                        <Upload className="w-10 h-10 text-emerald-500" />
                    </div>
                </div>
                <h2 className="rise-in text-2xl font-bold mb-2 text-slate-100" style={{ animationDelay: '70ms' }}>Load Energy Data</h2>

                {/* responsive text switching */}
                <p className="rise-in text-emerald-400/90 font-medium mb-2" style={{ animationDelay: '140ms' }}>
                    <span className="">Visualize and understand your usage</span>
                </p>

                <p className="rise-in text-slate-500 text-sm mb-8" style={{ animationDelay: '140ms' }}>Supports Green Button XML files<span className="hidden sm:inline"> with interval readings</span></p>

                {error && (
                    <div className="mb-6 p-4 bg-red-900/20 border border-red-900/50 rounded-lg flex items-start gap-3 text-left">
                        <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                        <p className="text-red-300 text-sm">{error}</p>
                    </div>
                )}

                <div className="rise-in flex flex-col gap-4" style={{ animationDelay: '280ms' }}>
                    <div className="flex gap-2">
                        <label className="relative cursor-pointer group flex-1">
                            <div className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-3 px-6 rounded-xl shadow-lg shadow-emerald-600/20 transition-colors flex items-center justify-center gap-2">
                                <FileText className="w-4 h-4" />
                                {loading ? 'Processing...' : 'Choose File'}
                            </div>
                            <input type="file" accept=".xml,.csv,.json" onChange={onUpload} className="hidden" disabled={loading} />
                        </label>
                        {historyCount > 0 && onShowHistory && (
                            <button
                                onClick={onShowHistory}
                                disabled={loading}
                                title={`${historyCount} recent file${historyCount !== 1 ? 's' : ''}`}
                                className="shrink-0 flex items-center gap-1.5 px-3 bg-surface-3 border border-line-2 hover:bg-white/5 hover:border-slate-500 text-slate-400 hover:text-slate-200 rounded-xl transition-colors disabled:opacity-40"
                            >
                                <History className="w-4 h-4" />
                                <span className="text-xs font-medium">{historyCount}</span>
                            </button>
                        )}
                    </div>

                    {/* Demo section with friendly nudge */}
                    <div className="relative mt-2">
                        <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/10 via-emerald-400/10 to-emerald-500/10 rounded-xl blur-xl opacity-50" />
                        <div className="relative bg-surface-3 border border-line-2 rounded-xl p-4">
                            <p className="text-sm text-slate-400 mb-3">
                                No file? <span className="text-slate-300 font-medium">See it in action first</span>
                            </p>
                            <button
                                onClick={onLoadSample}
                                disabled={loading}
                                className="w-full bg-black/20 border border-slate-600 text-slate-200 font-semibold text-base py-3 px-6 rounded-xl hover:border-slate-500 hover:text-white hover:bg-white/5 transition-colors flex items-center justify-center gap-2.5"
                            >
                                <Zap className="w-5 h-5" />
                                Try the Demo
                            </button>
                        </div>
                    </div>
                </div>

                {/* Info Section - more prominent */}
                <div className="rise-in mt-8 pt-6 border-t border-header-line" style={{ animationDelay: '350ms' }}>
                    <button
                        onClick={() => setShowInfo(!showInfo)}
                        aria-expanded={showInfo}
                        aria-controls="green-button-info"
                        className={`flex items-center justify-center gap-3 text-sm w-full py-2.5 px-4 rounded-lg transition-colors ${
                            showInfo
                                ? 'bg-emerald-500/12 text-emerald-300'
                                : 'text-slate-400 hover:text-emerald-400 hover:bg-white/5'
                        }`}
                    >
                        <Info className="w-4 h-4 flex-shrink-0" />
                        <span className="text-left">
                            <span className="sm:hidden">What's Green Button data?<br />How do I get it?</span>
                            <span className="hidden sm:inline">What's Green Button data & how do I get it?</span>
                        </span>
                        <ChevronDown className={`w-3 h-3 flex-shrink-0 transition-transform duration-300 ${EASE_OUT_EXPO} ${showInfo ? 'rotate-180' : ''}`} />
                    </button>

                    {/* Always mounted so it can animate both ways: the grid row
                        tweens 0fr ↔ 1fr, which animates to the content's real
                        height without measuring it. `inert` keeps the collapsed
                        links out of the tab order. */}
                    <div
                        id="green-button-info"
                        inert={!showInfo}
                        className={`grid transition-[grid-template-rows,opacity] duration-500 ${EASE_OUT_EXPO} motion-reduce:transition-none ${
                            showInfo ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                        }`}
                    >
                        <div className="min-h-0 overflow-hidden">
                        <div className={`pt-4 transition-transform duration-500 ${EASE_OUT_EXPO} motion-reduce:transition-none ${showInfo ? 'translate-y-0' : '-translate-y-3'}`}>
                        <div className="bg-sunken border border-line rounded-lg overflow-hidden text-left">
                            <div
                                ref={tabStrip.containerRef}
                                role="tablist"
                                aria-label="Green Button info"
                                className="relative flex border-b border-header-line"
                            >
                                {/* One tinted, underlined highlight that slides to the
                                    picked tab, like the modal tab bars. */}
                                {tabStrip.rect && (
                                    <div
                                        aria-hidden
                                        className={`${SLIDING_HIGHLIGHT_CLASS} bg-emerald-500/12 border-b-2 border-emerald-400`}
                                        style={highlightStyle(tabStrip.rect)}
                                    />
                                )}
                                {INFO_TABS.map(({ id, label }) => (
                                    <button
                                        key={id}
                                        ref={tabStrip.setItemRef(id)}
                                        onClick={() => setActiveTab(id)}
                                        role="tab"
                                        aria-selected={activeTab === id}
                                        aria-controls={`green-button-panel-${id}`}
                                        className={`relative flex-1 py-3 text-xs font-medium uppercase tracking-wider transition-colors ${activeTab === id ? 'text-emerald-300' : 'text-slate-400 hover:text-slate-200'}`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>

                            <div
                                className={`grid overflow-hidden transition-[height] duration-300 ${EASE_OUT_EXPO} motion-reduce:transition-none`}
                                style={{ height: paneHeight }}
                            >
                                    <div
                                        id="green-button-panel-format"
                                        ref={el => { paneRefs.current.format = el; }}
                                        role="tabpanel"
                                        aria-label="How to get it"
                                        inert={activeTab !== 'format'}
                                        className={`col-start-1 row-start-1 self-start p-5 transition-[opacity,transform] motion-reduce:transition-none ${paneClass('format')}`}
                                    >
                                        <div className="mb-5 pb-5 border-b border-header-line">
                                            <h4 className="font-semibold text-emerald-400 mb-2 flex items-center gap-2 text-sm">
                                                <Zap className="w-4 h-4" /> What is it?
                                            </h4>
                                            <p className="text-slate-400 text-xs leading-relaxed mb-3">
                                                Green Button is an industry-standard data format that allows utility customers to access and share their energy usage data securely. It creates a common XML language for energy data across different utility providers.
                                            </p>
                                            <a href="https://www.greenbuttondata.org/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-emerald-500 hover:text-emerald-300 transition-colors hover:underline">
                                                Learn more at GreenButtonData.org
                                                <ExternalLink className="w-3 h-3" />
                                            </a>
                                        </div>

                                        <div className="mb-5 pb-5 border-b border-header-line">
                                            <h4 className="font-semibold text-emerald-400 mb-2 flex items-center gap-2 text-sm">
                                                <Download className="w-4 h-4" /> General Instructions
                                            </h4>
                                            <ol className="list-decimal ml-4 space-y-2 text-slate-400 text-sm marker:text-slate-600">
                                                <li>Log in to your utility's website.</li>
                                                <li>Find "Green Button", "Download My Data", or "Export Usage".</li>
                                                <li>Select <strong>XML</strong> format (often called "Green Button Download").</li>
                                            </ol>
                                        </div>

                                        <div>
                                            <h4 className="font-semibold text-sky-400 mb-2 flex items-center gap-2 text-sm">
                                                <Building2 className="w-4 h-4" /> Xcel Energy Customers
                                            </h4>
                                            <ol className="list-decimal ml-4 space-y-2 text-slate-400 text-sm marker:text-slate-600">
                                                <li>Log in at <a href="https://my.xcelenergy.com/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300 hover:underline">my.xcelenergy.com</a></li>
                                                <li>Click <span className="inline-flex items-center gap-1"><strong>Visit My Energy</strong><ExternalLink className="w-3 h-3" /></span></li>
                                                <li>Select <strong>View My Usage & Cost</strong>.</li>
                                                <li>Click the <strong>Green Button Download</strong> button below the chart.</li>
                                            </ol>
                                        </div>
                                    </div>

                                    <div
                                        id="green-button-panel-privacy"
                                        ref={el => { paneRefs.current.privacy = el; }}
                                        role="tabpanel"
                                        aria-label="Privacy"
                                        inert={activeTab !== 'privacy'}
                                        className={`col-start-1 row-start-1 self-start p-5 space-y-4 transition-[opacity,transform] motion-reduce:transition-none ${paneClass('privacy')}`}
                                    >
                                        <div className="bg-surface-2 p-3 rounded border border-line-2 flex gap-3">
                                            <Lock className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                                            <p className="text-xs text-slate-400">
                                                We process this file <strong>locally in your browser</strong>.
                                                No personal information from your file is sent to us or any third parties.
                                            </p>
                                        </div>

                                        <div>
                                            <h4 className="font-semibold text-slate-300 mb-2 flex items-center gap-2 text-xs uppercase tracking-wide">
                                                <Scissors className="w-3 h-3" /> Manual Scrubbing Guide
                                            </h4>
                                            <p className="text-xs text-slate-400 mb-2">To be extra safe, you can edit the XML file before uploading:</p>
                                            <ol className="list-decimal ml-4 space-y-1 text-slate-500 text-xs marker:text-slate-600">
                                                <li>Open the <strong>.xml</strong> file in Notepad or TextEdit.</li>
                                                <li>Search (Ctrl+F) for your <strong>Name</strong>, <strong>Address</strong>, or <strong>Account #</strong>.</li>
                                                <li>Delete the text between the tags (e.g., replace your address with "REDACTED").</li>
                                                <li>Save the file and upload it here.</li>
                                            </ol>
                                        </div>
                                    </div>
                            </div>
                        </div>
                        </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer / Attribution */}
            <div className="rise-in mt-8 flex flex-col items-center gap-3 text-sm text-slate-500" style={{ animationDelay: '420ms' }}>
                <div className="flex items-center gap-1">
                    <span>created by</span>
                    <a href="https://jacobkrch.com" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 font-medium text-slate-400 hover:text-emerald-400 transition-colors">
                        <User className="w-3 h-3" />
                        Jacob Krch
                    </a>
                </div>
                <a href="https://github.com/jekrch/energy-meter" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs border border-line-2 bg-surface-2 px-3 py-1.5 rounded-full hover:bg-white/5 hover:text-emerald-400 transition-colors">
                    <Github className="w-3 h-3" />
                    <span>Open Source on GitHub</span>
                    <ExternalLink className="w-2.5 h-2.5 ml-0.5 opacity-50" />
                </a>
            </div>
        </div>
    );
});