import React, { useRef, useState } from 'react';
import { Upload, CheckCircle2, X, Loader2, ArrowRight, AlertCircle } from 'lucide-react';

interface ResumeUploadStepProps {
  initialRole: string;
  isLoading: boolean;
  error: string | null;
  onSubmit: (file: File, role: string) => Promise<void>;
}

const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.txt', '.png', '.jpg', '.jpeg', '.webp'];

const SUGGESTED_ROLES = [
  'Gen AI & Python Engineer',
  'Machine Learning',
  'Data Scientist',
  'Full Stack',
  'Backend Python Developer',
  'DevOps Engineer',
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const ResumeUploadStep: React.FC<ResumeUploadStepProps> = ({
  initialRole,
  isLoading,
  error,
  onSubmit,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [role, setRole] = useState(initialRole);
  const [isDragging, setIsDragging] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const validateAndSelectFile = (file: File | undefined) => {
    if (!file) return;
    const dotIdx = file.name.lastIndexOf('.');
    const ext = dotIdx >= 0 ? file.name.slice(dotIdx).toLowerCase() : '';
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      setValidationError(
        `Unsupported file format "${ext || 'unknown'}". Please upload PDF, DOCX, TXT, PNG, JPG, JPEG, or WEBP.`
      );
      return;
    }
    setValidationError(null);
    setSelectedFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    validateAndSelectFile(e.dataTransfer.files?.[0]);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setValidationError('Please upload a resume file before continuing.');
      return;
    }
    const trimmedRole = role.trim();
    if (!trimmedRole) {
      setValidationError('Please enter a valid target job role.');
      return;
    }
    setValidationError(null);
    await onSubmit(selectedFile, trimmedRole);
  };

  const displayError = validationError || error;

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-6 sm:px-6">
      <form
        onSubmit={handleFormSubmit}
        className="w-full max-w-4xl rounded-2xl border border-slate-200/90 bg-white px-6 py-7 sm:px-10 sm:py-8 shadow-[0_12px_40px_rgba(30,41,59,0.07)]"
      >
        <h1 className="text-center font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.75rem]">
          Start Your Preparation
        </h1>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(',')}
          onChange={(e) => validateAndSelectFile(e.target.files?.[0])}
          className="sr-only"
          id="resume-file-input"
          disabled={isLoading}
        />

        {/* Horizontal Resume Dropzone Block */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => !isLoading && inputRef.current?.click()}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !isLoading) {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`mt-5 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-9 sm:py-11 text-center transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3544B8] ${
            isDragging
              ? 'border-[#3544B8] bg-[#EEF2FF]'
              : 'border-slate-300 bg-[#FAFCFF] hover:border-[#3544B8]/60 hover:bg-[#F5F8FF]'
          }`}
        >
          <Upload className="h-7 w-7 text-slate-600" aria-hidden="true" />
          <p className="mt-3 text-base sm:text-lg font-semibold text-slate-900">
            Drag and Drop your Resume
          </p>

          {selectedFile ? (
            <div
              onClick={(e) => e.stopPropagation()}
              className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full border border-[#B8C6F5] bg-[#E7ECFB] px-3.5 py-1.5 text-xs sm:text-sm font-medium text-[#1E2A78]"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0 text-[#3544B8]" aria-hidden="true" />
              <span className="truncate font-mono">
                {selectedFile.name} ({formatBytes(selectedFile.size)})
              </span>
              <button
                type="button"
                disabled={isLoading}
                onClick={() => {
                  setSelectedFile(null);
                  if (inputRef.current) inputRef.current.value = '';
                }}
                aria-label="Remove selected file"
                className="ml-0.5 rounded-full p-0.5 text-[#3544B8] hover:bg-white/80 transition-colors cursor-pointer disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <p className="mt-1.5 text-xs text-slate-500">
              Click to browse · PDF, DOCX, TXT, PNG, JPG, JPEG, or WEBP
            </p>
          )}
        </div>

        {/* Target Job Role */}
        <div className="mt-5">
          <label
            htmlFor="target-role-input"
            className="block text-sm font-semibold text-slate-800"
          >
            Target Job Role
          </label>

          <input
            id="target-role-input"
            type="text"
            value={role}
            disabled={isLoading}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g., Gen AI & Python Engineer"
            className="mt-2 w-full rounded-lg border border-[#B8C4F0] bg-white px-4 py-2.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-[#3544B8] focus:outline-none focus:ring-2 focus:ring-[#3544B8]/15 disabled:bg-slate-50"
          />

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {SUGGESTED_ROLES.map((suggestion) => {
              const selected = role === suggestion;
              return (
                <button
                  key={suggestion}
                  type="button"
                  disabled={isLoading}
                  onClick={() => setRole(suggestion)}
                  className={`rounded-full border px-3.5 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50 ${
                    selected
                      ? 'border-[#3544B8] bg-[#E7ECFB] text-[#2E3BB8]'
                      : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50'
                  }`}
                >
                  {suggestion}
                </button>
              );
            })}
          </div>
        </div>

        {displayError && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-600" aria-hidden="true" />
            <span>{displayError}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#3B49DF] to-[#2E3BB8] px-6 py-3.5 text-sm font-semibold text-white shadow-sm hover:from-[#3340C9] hover:to-[#26319F] transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3544B8]"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>Parsing &amp; Analyzing Resume...</span>
            </>
          ) : (
            <>
              <span>Analyze Resume</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </>
          )}
        </button>
      </form>
    </div>
  );
};
