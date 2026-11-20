import React from 'react';
import type { WorkflowStep } from '../types/interview';

interface SidebarNavProps {
  currentStep: WorkflowStep;
  hasAnalysis: boolean;
  hasInterviewStarted: boolean;
  hasScorecard: boolean;
  onNavigate: (step: WorkflowStep) => void;
}

const STEPS: { id: WorkflowStep; label: string; subtitle: string }[] = [
  { id: 'upload', label: '1. Upload & Role', subtitle: 'Resume & target role' },
  { id: 'analysis', label: '2. Resume Analysis', subtitle: 'ATS score & skill gaps' },
  { id: 'interview', label: '3. Mock Interview', subtitle: 'Interactive Q&A session' },
  { id: 'scorecard', label: '4. Scorecard', subtitle: 'Final marks & report' },
];

export const SidebarNav: React.FC<SidebarNavProps> = ({
  currentStep,
  hasAnalysis,
  hasInterviewStarted,
  hasScorecard,
  onNavigate,
}) => {
  const isStepAvailable = (step: WorkflowStep): boolean => {
    if (step === 'upload') return true;
    if (step === 'analysis') return hasAnalysis;
    if (step === 'interview') return hasInterviewStarted;
    if (step === 'scorecard') return hasScorecard;
    return false;
  };

  return (
    <aside
      aria-label="Workflow navigation"
      className="w-full md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-slate-200/90 bg-white"
    >
      <div className="p-4 md:py-7 md:px-4">
        <p className="px-3 text-xs font-semibold text-slate-500">Assessment Steps</p>

        <nav className="mt-3 flex flex-col gap-1.5">
          {STEPS.map((step) => {
            const available = isStepAvailable(step.id);
            const active = currentStep === step.id;

            return (
              <button
                key={step.id}
                type="button"
                disabled={!available}
                onClick={() => available && onNavigate(step.id)}
                className={`w-full rounded-xl px-3.5 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3544B8] ${
                  active
                    ? 'bg-[#E7ECFB] text-[#2E3BB8] border border-[#C5D1F7]'
                    : available
                      ? 'text-slate-700 hover:bg-slate-50 hover:text-slate-900 border border-transparent cursor-pointer'
                      : 'text-slate-300 border border-transparent cursor-not-allowed'
                }`}
              >
                <span className="block text-sm font-semibold whitespace-nowrap">
                  {step.label}
                </span>
                <span
                  className={`mt-0.5 block text-xs whitespace-nowrap truncate ${
                    active ? 'text-[#3544B8]' : available ? 'text-slate-500' : 'text-slate-300'
                  }`}
                >
                  {step.subtitle}
                </span>
              </button>
            );
          })}
        </nav>
      </div>
    </aside>
  );
};
