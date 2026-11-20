import React from 'react';
import { ArrowRight } from 'lucide-react';

interface LandingViewProps {
  onStart: () => void;
}

export const LandingView: React.FC<LandingViewProps> = ({ onStart }) => {
  return (
    <div className="flex min-h-full items-center px-6 py-8 lg:px-12">
      <section className="mx-auto w-full max-w-3xl space-y-5">
        <p className="text-sm font-medium text-blue-700">
          Resume Diagnostics · Voice Mock Interview · Automated Scorecard
        </p>

        <h1
          className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-[2.75rem] leading-[1.15]"
          style={{ textWrap: 'balance' }}
        >
          Prepare for technical interviews with structured resume auditing and live voice evaluation.
        </h1>

        <p className="max-w-2xl text-base leading-relaxed text-slate-600">
          Upload your resume and specify your target role. Receive an instant ATS readiness report,
          then enter a 10-question mock interview with spoken prompts, microphone transcription,
          per-question grading, and a comprehensive final scorecard.
        </p>

        <div className="pt-2">
          <button
            type="button"
            onClick={onStart}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-800 transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            <span>Begin Resume Analysis</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  );
};
