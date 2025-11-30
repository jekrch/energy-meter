import React from 'react';
import { Upload, FileText, AlertCircle } from 'lucide-react';

interface UploadSectionProps {
    onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onLoadSample: () => void;
    loading: boolean;
    error: string | null;
}

export const UploadSection = React.memo(function UploadSection({ onUpload, onLoadSample, loading, error }: UploadSectionProps) {
    return (
        <div className="max-w-xl mx-auto mt-12">
            <div className="bg-slate-900 rounded-xl shadow-xl border border-slate-800 p-8 text-center">
                <div className="bg-slate-800 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6 ring-1 ring-slate-700">
                    <Upload className="w-10 h-10 text-emerald-500" />
                </div>
                <h2 className="text-2xl font-bold mb-2">Upload Energy Data</h2>
                <p className="text-slate-400 mb-8">Supports Green Button XML files with interval readings.</p>

                {error && (
                    <div className="mb-6 p-4 bg-red-900/20 border border-red-900/50 rounded-lg flex items-start gap-3 text-left">
                        <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                        <p className="text-red-300 text-sm">{error}</p>
                    </div>
                )}

                <div className="flex flex-col gap-4">
                    <label className="relative cursor-pointer">
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
                    <div className="relative my-2">
                        <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t border-slate-700" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-slate-900 px-2 text-slate-500">Or</span>
                        </div>
                    </div>
                    <button
                        onClick={onLoadSample}
                        disabled={loading}
                        className="w-full border-2 border-slate-700 text-slate-400 font-medium py-3 px-6 rounded-lg hover:border-emerald-500 hover:text-emerald-400 transition-all"
                    >
                        Load Demo (5,000 pts)
                    </button>
                </div>
            </div>
        </div>
    );
});