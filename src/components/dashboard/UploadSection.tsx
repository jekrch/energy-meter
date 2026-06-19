import React, { useState } from 'react';
import {
    Upload, FileText, AlertCircle, Info, ChevronDown, ChevronUp,
    Download, Lock, Github, ExternalLink, User, Scissors, Zap, Building2,
} from 'lucide-react';

interface UploadSectionProps {
    onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onLoadSample: () => void;
    loading: boolean;
    error: string | null;
}

export const UploadSection = React.memo(function UploadSection({ onUpload, onLoadSample, loading, error }: UploadSectionProps) {
    const [showInfo, setShowInfo] = useState(false);
    const [activeTab, setActiveTab] = useState<'format' | 'privacy'>('format');

    return (
        <div className="max-w-xl mx-auto mt-0 pb-12">
            <div className="bg-surface rounded-2xl border border-line p-8 text-center transition-colors duration-300">
                <div className="bg-surface-2 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ring-1 ring-line-2">
                    <Upload className="w-10 h-10 text-emerald-500" />
                </div>
                <h2 className="text-2xl font-bold mb-2 text-slate-100">Upload Energy Data</h2>
                
                {/* responsive text switching */}
                <p className="text-emerald-400/90 font-medium mb-2">
                    <span className="">Visualize and understand your usage</span>
                </p>

                <p className="text-slate-500 text-sm mb-8">Supports Green Button XML files<span className="hidden sm:inline"> with interval readings</span></p>

                {error && (
                    <div className="mb-6 p-4 bg-red-900/20 border border-red-900/50 rounded-lg flex items-start gap-3 text-left">
                        <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                        <p className="text-red-300 text-sm">{error}</p>
                    </div>
                )}

                <div className="flex flex-col gap-4">
                    <label className="relative cursor-pointer group">
                        <div className="w-full bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2">
                            <FileText className="w-4 h-4" />
                            {loading ? 'Processing...' : 'Choose XML or CSV File'}
                        </div>
                        <input type="file" accept=".xml,.csv" onChange={onUpload} className="hidden" disabled={loading} />
                    </label>

                    {/* Demo section with friendly nudge */}
                    <div className="relative mt-2">
                        <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/10 via-emerald-400/10 to-emerald-500/10 rounded-xl blur-xl opacity-50" />
                        <div className="relative bg-surface-2 border border-line-2 rounded-xl p-4">
                            <p className="text-sm text-slate-400 mb-3">
                                No file? <span className="text-slate-300 font-medium">See it in action first</span>
                            </p>
                            <button
                                onClick={onLoadSample}
                                disabled={loading}
                                className="w-full bg-sunken border border-line text-slate-300 font-medium py-2.5 px-6 rounded-lg hover:border-line-2 hover:text-white hover:bg-white/5 transition-colors flex items-center justify-center gap-2"
                            >
                                <Zap className="w-4 h-4" />
                                Try the Demo
                            </button>
                        </div>
                    </div>
                </div>

                {/* Info Section - more prominent */}
                <div className="mt-8 pt-6 border-t border-header-line">
                    <button
                        onClick={() => setShowInfo(!showInfo)}
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
                        {showInfo ? <ChevronUp className="w-3 h-3 flex-shrink-0" /> : <ChevronDown className="w-3 h-3 flex-shrink-0" />}
                    </button>

                    {showInfo && (
                        <div className="mt-4 bg-sunken border border-line rounded-lg overflow-hidden animate-in fade-in slide-in-from-top-2 text-left">
                            <div className="flex border-b border-header-line">
                                <button
                                    onClick={() => setActiveTab('format')}
                                    className={`flex-1 py-3 text-xs font-medium uppercase tracking-wider transition-colors ${activeTab === 'format' ? 'bg-emerald-500/12 text-emerald-300' : 'text-slate-400 hover:text-slate-200'}`}
                                >
                                    How to get it
                                </button>
                                <button
                                    onClick={() => setActiveTab('privacy')}
                                    className={`flex-1 py-3 text-xs font-medium uppercase tracking-wider transition-colors ${activeTab === 'privacy' ? 'bg-emerald-500/12 text-emerald-300' : 'text-slate-400 hover:text-slate-200'}`}
                                >
                                    Privacy
                                </button>
                            </div>

                            <div className="p-5">
                                {activeTab === 'format' ? (
                                    <>
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
                                    </>
                                ) : (
                                    <div className="space-y-4">
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
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Footer / Attribution */}
            <div className="mt-8 flex flex-col items-center gap-3 text-sm text-slate-500">
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