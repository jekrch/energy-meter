import React, { useState } from 'react';
import { 
    Upload, 
    FileText, 
    AlertCircle, 
    Info, 
    ChevronDown, 
    ChevronUp, 
    Download, 
    Lock, 
    Github, 
    ExternalLink, 
    User,
    Scissors
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
        <div className="max-w-xl mx-auto mt-12 pb-12">
            <div className="bg-slate-900 rounded-xl shadow-xl border border-slate-800 p-8 text-center transition-all duration-300">
                <div className="bg-slate-800 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ring-1 ring-slate-700">
                    <Upload className="w-10 h-10 text-emerald-500" />
                </div>
                <h2 className="text-2xl font-bold mb-2 text-slate-100">Upload Energy Data</h2>
                <p className="text-slate-400 mb-8">Supports Green Button XML files with interval readings.</p>

                {error && (
                    <div className="mb-6 p-4 bg-red-900/20 border border-red-900/50 rounded-lg flex items-start gap-3 text-left">
                        <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                        <p className="text-red-300 text-sm">{error}</p>
                    </div>
                )}

                <div className="flex flex-col gap-4">
                    <label className="relative cursor-pointer group">
                        <div className="w-full bg-emerald-600 text-white font-medium py-3 px-6 rounded-lg shadow-lg hover:bg-emerald-500 transition-all flex items-center justify-center gap-2">
                            <FileText className="w-4 h-4" />
                            {loading ? 'Processing...' : 'Choose XML File'}
                        </div>
                        <input
                            type="file"
                            accept=".xml"
                            onChange={onUpload}
                            className="hidden"
                            disabled={loading}
                        />
                    </label>
                    
                    <button
                        onClick={onLoadSample}
                        disabled={loading}
                        className="w-full border-2 border-slate-700 text-slate-400 font-medium py-3 px-6 rounded-lg hover:border-emerald-500 hover:text-emerald-400 transition-all"
                    >
                        Load Demo (5,000 pts)
                    </button>
                </div>

                {/* --- Collapsible Info Section --- */}
                <div className="mt-8 pt-6 border-t border-slate-800">
                    <button 
                        onClick={() => setShowInfo(!showInfo)}
                        className="flex items-center justify-center gap-2 text-sm text-slate-500 hover:text-emerald-400 transition-colors w-full"
                    >
                        <Info className="w-4 h-4" />
                        <span>About Green Button Data</span>
                        {showInfo ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </button>

                    {showInfo && (
                        <div className="mt-4 bg-slate-800/50 rounded-lg overflow-hidden animate-in fade-in slide-in-from-top-2 text-left">
                            <div className="flex border-b border-slate-700">
                                <button 
                                    onClick={() => setActiveTab('format')}
                                    className={`flex-1 py-3 text-xs font-medium uppercase tracking-wider transition-colors ${activeTab === 'format' ? 'bg-slate-700 text-emerald-400' : 'text-slate-400 hover:text-slate-200'}`}
                                >
                                    How to get it
                                </button>
                                <button 
                                    onClick={() => setActiveTab('privacy')}
                                    className={`flex-1 py-3 text-xs font-medium uppercase tracking-wider transition-colors ${activeTab === 'privacy' ? 'bg-slate-700 text-emerald-400' : 'text-slate-400 hover:text-slate-200'}`}
                                >
                                    Privacy
                                </button>
                            </div>

                            <div className="p-5">
                                {activeTab === 'format' ? (
                                    <>
                                        <h4 className="font-semibold text-emerald-400 mb-2 flex items-center gap-2 text-sm">
                                            <Download className="w-4 h-4" /> Instructions
                                        </h4>
                                        <ol className="list-decimal list-inside space-y-2 text-slate-400 text-sm marker:text-slate-600">
                                            <li>Log in to your utility's website.</li>
                                            <li>Find "Green Button", "Download My Data", or "Export Usage".</li>
                                            <li>Select <strong>XML</strong> format.</li>
                                        </ol>
                                    </>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="bg-slate-900/50 p-3 rounded border border-slate-700/50 flex gap-3">
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
                                            <p className="text-xs text-slate-400 mb-2">
                                                To be extra safe, you can edit the XML file before uploading:
                                            </p>
                                            <ol className="list-decimal list-inside space-y-1 text-slate-500 text-xs marker:text-slate-600">
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

            {/* --- Footer / Attribution --- */}
            <div className="mt-8 flex flex-col items-center gap-3 text-sm text-slate-500">
                <div className="flex items-center gap-1">
                    <span>Created by</span>
                    <a 
                        href="https://jacobkrch.com" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 font-medium text-slate-400 hover:text-emerald-400 transition-colors"
                    >
                        <User className="w-3 h-3" />
                        Jacob Krch
                    </a>
                </div>
                <a 
                    href="https://github.com/jekrch/energy-meter" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs border border-slate-800 bg-slate-900/50 px-3 py-1.5 rounded-full hover:bg-slate-800 hover:text-emerald-400 transition-colors"
                >
                    <Github className="w-3 h-3" />
                    <span>Open Source on GitHub</span>
                    <ExternalLink className="w-2.5 h-2.5 ml-0.5 opacity-50" />
                </a>
            </div>
        </div>
    );
});