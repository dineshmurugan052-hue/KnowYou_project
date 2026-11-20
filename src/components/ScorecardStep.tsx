import React, { useEffect, useRef } from 'react';
import { Download, RotateCcw, Volume2, Award } from 'lucide-react';
import type { InterviewLogItem } from '../types/interview';

interface ScorecardStepProps {
  role: string;
  filename: string;
  scored: number;
  total: number;
  percentage: number;
  audioUrl: string | null;
  report: string;
  log: InterviewLogItem[];
  maxQ?: number;
  exitedEarly?: boolean;
  onReset: () => void;
}

export const ScorecardStep: React.FC<ScorecardStepProps> = ({
  role,
  filename,
  scored,
  total,
  percentage,
  audioUrl,
  report,
  log,
  maxQ,
  exitedEarly = false,
  onReset,
}) => {
  const finalAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audioEl = finalAudioRef.current;
    if (audioUrl && audioEl) {
      audioEl.load();
      audioEl.play().catch(() => {
        // User can press play manually if autoplay is blocked
      });
    }
    return () => {
      if (audioEl) {
        audioEl.pause();
      }
    };
  }, [audioUrl]);

  const handleDownloadReport = () => {
    const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `interview_scorecard_${role.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const performanceBand =
    log.length === 0
      ? { label: 'No Questions Answered', color: 'text-slate-600', bar: 'bg-slate-300' }
      : percentage >= 75
        ? { label: 'Strong Performance', color: 'text-emerald-700', bar: 'bg-emerald-600' }
        : percentage >= 50
          ? { label: 'Satisfactory Performance', color: 'text-amber-700', bar: 'bg-amber-500' }
          : { label: 'Needs Improvement', color: 'text-red-700', bar: 'bg-red-600' };

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <p className="text-xs font-medium text-slate-500">
            <span>Step 04</span>
            <span aria-hidden="true"> · </span>
            <span>Final Interview Scorecard</span>
            <span aria-hidden="true"> · </span>
            <span>{filename}</span>
            <span aria-hidden="true"> · </span>
            <span>{role}</span>
          </p>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Interview Performance Report
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleDownloadReport}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Download Scorecard</span>
          </button>

          <button
            type="button"
            onClick={onReset}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Start New Interview</span>
          </button>
        </div>
      </div>

      {/* Hero Summary Row */}
      <section className="grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-900">Total Marks</span>
            <Award className="h-5 w-5 text-emerald-700" aria-hidden="true" />
          </div>

          <div className="mt-6 flex items-baseline justify-between gap-4">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-5xl font-bold text-slate-900 tabular-nums">
                {scored}
              </span>
              <span className="font-mono text-lg text-slate-400 tabular-nums">/ {total}</span>
            </div>
            <div className="text-right">
              <p className={`font-mono text-2xl font-bold tabular-nums ${performanceBand.color}`}>
                {percentage}%
              </p>
              <p className={`text-xs font-medium ${performanceBand.color}`}>
                {performanceBand.label}
              </p>
            </div>
          </div>

          <div className="mt-6 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full ${performanceBand.bar}`}
              style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
            />
          </div>
        </div>

        <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Interviewer Closing Summary</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              {exitedEarly ? (
                <>
                  Interview ended after answering{' '}
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {log.length}
                  </span>{' '}
                  of{' '}
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {maxQ ?? log.length}
                  </span>{' '}
                  planned {maxQ === 1 ? 'question' : 'questions'} for the{' '}
                  <span className="font-medium text-slate-900">{role}</span> role. Your final
                  score reflects the{' '}
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {log.length}
                  </span>{' '}
                  {log.length === 1 ? 'question' : 'questions'} you answered below.
                </>
              ) : (
                <>
                  All{' '}
                  <span className="font-mono font-semibold text-slate-900 tabular-nums">
                    {log.length}
                  </span>{' '}
                  {log.length === 1 ? 'question' : 'questions'} tailored to your resume for the{' '}
                  <span className="font-medium text-slate-900">{role}</span> role have been graded
                  and logged. Review the question-wise breakdown below to identify high-scoring
                  topics and areas for deeper technical preparation.
                </>
              )}
            </p>
          </div>

          {audioUrl && (
            <div className="mt-6 flex flex-wrap items-center gap-3 pt-4 border-t border-slate-100">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-700">
                <Volume2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                <span>Closing Audio</span>
              </div>
              <audio ref={finalAudioRef} controls src={audioUrl} className="h-9 flex-1 min-w-[220px]" />
            </div>
          )}
        </div>
      </section>

      {/* Question-Wise Table */}
      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">Question-Wise Breakdown</h2>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {log.length}
            {maxQ ? ` / ${maxQ}` : ''} Questions Graded
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 pl-6 pr-3 w-14">No.</th>
                <th className="py-3 px-3 min-w-[220px]">Question</th>
                <th className="py-3 px-3 min-w-[220px]">Your Answer</th>
                <th className="py-3 px-3 min-w-[240px]">Interviewer Feedback</th>
                <th className="py-3 pl-3 pr-6 text-right w-24">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {log.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 px-6 text-center text-sm text-slate-500">
                    No questions were answered before exiting the interview.
                  </td>
                </tr>
              ) : (
                log.map((item) => (
                  <tr key={item.step} className="hover:bg-slate-50/70 align-top">
                    <td className="py-4 pl-6 pr-3 font-mono text-xs font-semibold text-slate-500 tabular-nums">
                      Q{item.step}
                    </td>
                    <td className="py-4 px-3 font-medium text-slate-900 leading-relaxed">
                      {item.q}
                    </td>
                    <td className="py-4 px-3 text-slate-700 leading-relaxed">{item.ans}</td>
                    <td className="py-4 px-3 text-slate-600 leading-relaxed">{item.note}</td>
                    <td className="py-4 pl-3 pr-6 text-right font-mono font-semibold tabular-nums whitespace-nowrap">
                      <span
                        className={
                          item.mark >= 7
                            ? 'text-emerald-700'
                            : item.mark >= 4
                              ? 'text-amber-700'
                              : 'text-red-700'
                        }
                      >
                        {item.mark}
                      </span>
                      <span className="text-slate-400"> / 10</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
