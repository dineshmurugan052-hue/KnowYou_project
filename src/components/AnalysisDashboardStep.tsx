import React, { useState } from 'react';
import {
  ArrowRight,
  Loader2,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Volume2,
  FileText,
} from 'lucide-react';
import type { AnalyzeResponse } from '../types/interview';

interface AnalysisDashboardStepProps {
  analysis: AnalyzeResponse;
  audioMode: boolean;
  onAudioModeChange: (enabled: boolean) => void;
  isStartingInterview: boolean;
  error: string | null;
  onStartInterview: (maxQ: number) => Promise<void>;
  onBackToUpload: () => void;
}

function cleanMarkdownText(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      if (index === 0) {
        return line.replace(
          /^(?:#{1,4}\s*)?(?:\*{0,2})?[123][\.\):]?\s*(?:ats\s*score|missing\s*skill\s*set|improvement\s*in\s*topics)\s*:?\s*(?:\*{0,2})?\s*/i,
          ''
        );
      }
      return line;
    })
    .filter(Boolean)
    .map((line) => line.replace(/^[-*•]\s*/, '').replace(/\*\*/g, ''));
}

export const AnalysisDashboardStep: React.FC<AnalysisDashboardStepProps> = ({
  analysis,
  audioMode,
  onAudioModeChange,
  isStartingInterview,
  error,
  onStartInterview,
  onBackToUpload,
}) => {
  const [viewMode, setViewMode] = useState<'structured' | 'raw'>('structured');
  const [maxQ, setMaxQ] = useState<number>(10);
  const [maxQInput, setMaxQInput] = useState<string>('10');
  const { parsed, report, filename, role } = analysis;

  const clampMaxQ = (value: number): number => {
    if (!Number.isFinite(value)) return 10;
    return Math.max(1, Math.min(25, Math.round(value)));
  };

  const selectMaxQ = (value: number) => {
    const clamped = clampMaxQ(value);
    setMaxQ(clamped);
    setMaxQInput(String(clamped));
  };

  const handleMaxQInputChange = (rawValue: string) => {
    setMaxQInput(rawValue);
    const parsedNum = parseInt(rawValue, 10);
    if (!Number.isNaN(parsedNum)) {
      setMaxQ(clampMaxQ(parsedNum));
    }
  };

  const handleMaxQBlur = () => {
    const parsedNum = parseInt(maxQInput, 10);
    const clamped = Number.isNaN(parsedNum) ? maxQ : clampMaxQ(parsedNum);
    setMaxQ(clamped);
    setMaxQInput(String(clamped));
  };

  const handleLaunchInterview = () => {
    const parsedNum = parseInt(maxQInput, 10);
    const validMaxQ = Number.isNaN(parsedNum) ? clampMaxQ(maxQ) : clampMaxQ(parsedNum);
    setMaxQ(validMaxQ);
    setMaxQInput(String(validMaxQ));
    void onStartInterview(validMaxQ);
  };

  const score = parsed.atsScore;
  const scoreColorClass =
    score === null
      ? 'text-slate-900'
      : score >= 75
        ? 'text-emerald-700'
        : score >= 50
          ? 'text-amber-700'
          : 'text-red-700';

  const scoreBarClass =
    score === null
      ? 'bg-slate-700'
      : score >= 75
        ? 'bg-emerald-600'
        : score >= 50
          ? 'bg-amber-500'
          : 'bg-red-600';

  const scoreLabel =
    score === null
      ? 'Analyzed'
      : score >= 75
        ? 'Strong Match'
        : score >= 50
          ? 'Moderate Match'
          : 'Needs Optimization';

  const atsLines = cleanMarkdownText(parsed.atsSection);
  const missingLines = cleanMarkdownText(parsed.missingSkillsSection);
  const improvementLines = cleanMarkdownText(parsed.improvementSection);
  const hasStructuredSections =
    Boolean(parsed.atsSection || parsed.missingSkillsSection || parsed.improvementSection);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <p className="text-xs font-medium text-slate-500">
            <span>Step 02</span>
            <span aria-hidden="true"> · </span>
            <span>{filename}</span>
            <span aria-hidden="true"> · </span>
            <span>Target Role: {role}</span>
          </p>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Resume Analysis Dashboard
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setViewMode('structured')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                viewMode === 'structured'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Structured View
            </button>
            <button
              type="button"
              onClick={() => setViewMode('raw')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                viewMode === 'raw'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Full Report
            </button>
          </div>

          <button
            type="button"
            onClick={onBackToUpload}
            disabled={isStartingInterview}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            Change Resume
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-6 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-600" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {viewMode === 'structured' && hasStructuredSections ? (
        <div className="mt-8 space-y-6">
          {/* Primary Row: ATS Score + Interview Launch CTA */}
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="lg:col-span-8 rounded-xl border border-slate-200 bg-white p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">1. ATS Compatibility Score</h2>
                  <p className="mt-0.5 text-xs text-slate-500">Evaluated for {role}</p>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className={`font-mono text-4xl font-bold tabular-nums ${scoreColorClass}`}>
                    {score !== null ? score : '--'}
                  </span>
                  <span className="font-mono text-sm text-slate-400 tabular-nums">/ 100</span>
                  <span className={`ml-2 text-xs font-semibold ${scoreColorClass}`}>{scoreLabel}</span>
                </div>
              </div>

              {score !== null && (
                <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${scoreBarClass}`}
                    style={{ width: `${score}%` }}
                  />
                </div>
              )}

              <div className="mt-5 space-y-2 text-sm leading-relaxed text-slate-700">
                {atsLines.length > 0 ? (
                  atsLines.map((line, i) => <p key={i}>{line}</p>)
                ) : (
                  <p className="text-slate-500">See Full Report tab for complete ATS commentary.</p>
                )}
              </div>
            </div>

            <div className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs font-medium text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  <span>Resume Parsed &amp; Ready</span>
                </div>
                <h2 className="mt-3 text-lg font-semibold text-slate-900">
                  Proceed to Mock Interview
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  Complete{' '}
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">{maxQ}</span>{' '}
                  tailored technical {maxQ === 1 ? 'question' : 'questions'} grounded directly in
                  your resume skills and projects.
                </p>

                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="max-q-input"
                      className="text-xs font-semibold text-slate-700"
                    >
                      Number of Questions
                    </label>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                      1–25 max
                    </span>
                  </div>

                  <div className="mt-2.5 flex items-center gap-2">
                    <div className="flex items-center gap-1.5 flex-1">
                      {[3, 5, 10, 15].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          disabled={isStartingInterview}
                          onClick={() => selectMaxQ(preset)}
                          className={`flex-1 rounded-md border px-2 py-1.5 font-mono text-xs font-semibold tabular-nums transition-colors cursor-pointer disabled:opacity-50 ${
                            maxQ === preset
                              ? 'border-[#3544B8] bg-[#3544B8] text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                    <input
                      id="max-q-input"
                      type="number"
                      min={1}
                      max={25}
                      disabled={isStartingInterview}
                      value={maxQInput}
                      onChange={(e) => handleMaxQInputChange(e.target.value)}
                      onBlur={handleMaxQBlur}
                      aria-label="Custom number of interview questions"
                      className="w-16 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-center font-mono text-xs font-semibold text-slate-900 tabular-nums focus:border-[#3544B8] focus:outline-none focus:ring-2 focus:ring-[#3544B8]/15 disabled:opacity-50"
                    />
                  </div>
                </div>

                {/* Question Delivery Mode */}
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                  <span className="block text-xs font-semibold text-slate-700">
                    Question Delivery Mode
                  </span>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      disabled={isStartingInterview}
                      onClick={() => onAudioModeChange(true)}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-2 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 ${
                        audioMode
                          ? 'border-[#3544B8] bg-[#3544B8] text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <Volume2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>Text + Audio</span>
                    </button>
                    <button
                      type="button"
                      disabled={isStartingInterview}
                      onClick={() => onAudioModeChange(false)}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-2 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 ${
                        !audioMode
                          ? 'border-[#3544B8] bg-[#3544B8] text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>Text Only</span>
                    </button>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleLaunchInterview}
                disabled={isStartingInterview}
                className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#3B49DF] to-[#2E3BB8] px-5 py-3 text-sm font-semibold text-white hover:from-[#3340C9] hover:to-[#26319F] transition-all cursor-pointer whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3544B8]"
              >
                {isStartingInterview ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Preparing Question 1...</span>
                  </>
                ) : (
                  <>
                    <span>Start {maxQ}-Question Interview</span>
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Secondary Row: Missing Skills & Improvement Topics */}
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-slate-200 bg-white p-6">
              <div className="flex items-center gap-2 pb-4 border-b border-slate-100">
                <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />
                <h2 className="text-base font-semibold text-slate-900">2. Missing Skill Set</h2>
              </div>
              <ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-slate-700">
                {missingLines.length > 0 ? (
                  missingLines.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2.5">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-slate-500">No missing skill entries extracted. View Full Report.</li>
                )}
              </ul>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-6">
              <div className="flex items-center gap-2 pb-4 border-b border-slate-100">
                <TrendingUp className="h-4 w-4 text-[#3544B8]" aria-hidden="true" />
                <h2 className="text-base font-semibold text-slate-900">3. Improvement in Topics</h2>
              </div>
              <ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-slate-700">
                {improvementLines.length > 0 ? (
                  improvementLines.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2.5">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#3544B8]" aria-hidden="true" />
                      <span>{item}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-slate-500">No improvement entries extracted. View Full Report.</li>
                )}
              </ul>
            </section>
          </div>
        </div>
      ) : (
        <div className="mt-8 space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-base font-semibold text-slate-900 pb-4 border-b border-slate-100">
              Complete Resume Analysis Report ({role})
            </h2>
            <pre className="mt-4 whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-700">
              {report}
            </pre>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-4">
            <div className="flex items-center gap-2.5">
              <label htmlFor="max-q-raw-input" className="text-xs font-medium text-slate-600">
                Questions (1–25):
              </label>
              <input
                id="max-q-raw-input"
                type="number"
                min={1}
                max={25}
                disabled={isStartingInterview}
                value={maxQInput}
                onChange={(e) => handleMaxQInputChange(e.target.value)}
                onBlur={handleMaxQBlur}
                className="w-16 rounded-md border border-slate-300 bg-white px-2.5 py-2 text-center font-mono text-xs font-semibold text-slate-900 tabular-nums focus:border-[#3544B8] focus:outline-none focus:ring-2 focus:ring-[#3544B8]/15 disabled:opacity-50"
              />
            </div>

            <button
              type="button"
              onClick={handleLaunchInterview}
              disabled={isStartingInterview}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#3B49DF] to-[#2E3BB8] px-6 py-3 text-sm font-semibold text-white hover:from-[#3340C9] hover:to-[#26319F] transition-all cursor-pointer whitespace-nowrap disabled:opacity-60"
            >
              {isStartingInterview ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>Preparing Question 1...</span>
                </>
              ) : (
                <>
                  <span>Start {maxQ}-Question Interview</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
