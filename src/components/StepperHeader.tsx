import React from 'react';
import { Monitor } from 'lucide-react';
import type { WorkflowStep } from '../types/interview';

interface StepperHeaderProps {
  onNavigate: (step: WorkflowStep) => void;
}

export const StepperHeader: React.FC<StepperHeaderProps> = ({ onNavigate }) => {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/90 bg-white/95 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-6 px-6 py-3">
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('upload')}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#3B49DF] to-[#27339A] text-white shadow-sm hover:opacity-95 transition-opacity cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3544B8]"
            aria-label="KnowYou home"
          >
            <Monitor className="h-5 w-5" aria-hidden="true" />
          </button>

          <div>
            <button
              type="button"
              onClick={() => onNavigate('upload')}
              className="font-display block text-left text-2xl sm:text-[1.75rem] font-extrabold tracking-[-0.035em] leading-none text-slate-900 whitespace-nowrap hover:opacity-85 transition-opacity cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#3544B8]"
            >
              Know<span className="text-[#3544B8]">You</span>
            </button>
            <p className="mt-1 text-xs font-medium text-slate-500 whitespace-nowrap">
              Go-to Interview Prep Application
            </p>
          </div>
        </div>
      </div>
    </header>
  );
};
