import { useState } from 'react';
import { StepperHeader } from './components/StepperHeader';
import { SidebarNav } from './components/SidebarNav';
import { ResumeUploadStep } from './components/ResumeUploadStep';
import { AnalysisDashboardStep } from './components/AnalysisDashboardStep';
import { InterviewRoomStep } from './components/InterviewRoomStep';
import { ScorecardStep } from './components/ScorecardStep';
import { analyzeResume, startInterview, submitInterviewAnswer, exitInterview } from './services/api';
import type {
  AnalyzeResponse,
  InterviewLogItem,
  WorkflowStep,
} from './types/interview';

interface ScorecardState {
  scored: number;
  total: number;
  percentage: number;
  audioUrl: string | null;
  report: string;
  log: InterviewLogItem[];
  maxQ: number;
  exitedEarly?: boolean;
}

export default function App() {
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('upload');

  // Step 1 & 2 state
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Step 3 state
  const [audioMode, setAudioMode] = useState(true);
  const [isStartingInterview, setIsStartingInterview] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [interviewActive, setInterviewActive] = useState(false);
  const [interviewStep, setInterviewStep] = useState(1);
  const [maxQ, setMaxQ] = useState(10);
  const [currentQuestion, setCurrentQuestion] = useState('');
  const [currentAudioUrl, setCurrentAudioUrl] = useState<string | null>(null);
  const [latestTurn, setLatestTurn] = useState<InterviewLogItem | null>(null);
  const [interviewLog, setInterviewLog] = useState<InterviewLogItem[]>([]);
  const [noAnswerWarning, setNoAnswerWarning] = useState<string | null>(null);
  const [interviewError, setInterviewError] = useState<string | null>(null);
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false);
  const [isExitingInterview, setIsExitingInterview] = useState(false);

  // Step 4 state
  const [scorecard, setScorecard] = useState<ScorecardState | null>(null);

  const isBusy =
    isAnalyzing || isStartingInterview || isSubmittingAnswer || isExitingInterview;

  const handleNavigate = (step: WorkflowStep) => {
    if (isBusy) return;
    if (step === 'analysis' && !analysis) return;
    if (step === 'interview' && !interviewActive) return;
    if (step === 'scorecard' && !scorecard) return;
    setCurrentStep(step);
  };

  const handleReset = () => {
    if (isBusy) return;
    setCurrentStep('upload');
    setAnalysis(null);
    setUploadError(null);
    setAnalysisError(null);
    setInterviewActive(false);
    setInterviewStep(1);
    setMaxQ(10);
    setCurrentQuestion('');
    setCurrentAudioUrl(null);
    setLatestTurn(null);
    setInterviewLog([]);
    setNoAnswerWarning(null);
    setInterviewError(null);
    setScorecard(null);
  };

  const handleAnalyzeSubmit = async (file: File, role: string) => {
    setIsAnalyzing(true);
    setUploadError(null);
    setAnalysisError(null);
    try {
      const result = await analyzeResume(file, role);
      setAnalysis(result);
      setInterviewActive(false);
      setScorecard(null);
      setInterviewLog([]);
      setLatestTurn(null);
      setCurrentStep('analysis');
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'Failed to parse and analyze resume.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleStartInterview = async (chosenMaxQ: number) => {
    if (!analysis) return;
    setIsStartingInterview(true);
    setAnalysisError(null);
    setInterviewError(null);
    setNoAnswerWarning(null);
    try {
      const started = await startInterview(analysis.sessionId, chosenMaxQ, audioMode);
      setInterviewActive(true);
      setInterviewStep(started.step);
      setMaxQ(started.maxQ);
      setCurrentQuestion(started.question);
      setCurrentAudioUrl(started.audioUrl);
      setLatestTurn(null);
      setInterviewLog(started.log);
      setScorecard(null);
      setCurrentStep('interview');
    } catch (err) {
      setAnalysisError(
        err instanceof Error ? err.message : 'Failed to initialize interview session.'
      );
    } finally {
      setIsStartingInterview(false);
    }
  };

  const handleSubmitAnswer = async (
    boxText: string,
    micWav: Blob | null
  ): Promise<boolean> => {
    if (!analysis) return false;
    setIsSubmittingAnswer(true);
    setNoAnswerWarning(null);
    setInterviewError(null);

    try {
      const res = await submitInterviewAnswer(analysis.sessionId, boxText, micWav, audioMode);

      if (res.noAnswer) {
        setNoAnswerWarning(
          res.info || 'No answer detected. Please record your voice or type your answer.'
        );
        return false;
      }

      setInterviewLog(res.log);
      setLatestTurn(res.latestTurn);

      if (res.completed) {
        setScorecard({
          scored: res.scored ?? 0,
          total: res.total ?? res.maxQ * 10,
          percentage: res.percentage ?? 0,
          audioUrl: res.audioUrl,
          report: res.report ?? '',
          log: res.log,
          maxQ: res.maxQ,
          exitedEarly: false,
        });
        setInterviewActive(false);
        setCurrentStep('scorecard');
        return true;
      }

      setInterviewStep(res.step);
      setMaxQ(res.maxQ);
      if (res.question) {
        setCurrentQuestion(res.question);
      }
      setCurrentAudioUrl(res.audioUrl);
      return true;
    } catch (err) {
      setInterviewError(
        err instanceof Error ? err.message : 'Failed to evaluate your answer.'
      );
      return false;
    } finally {
      setIsSubmittingAnswer(false);
    }
  };

  const handleExitInterview = async () => {
    if (!analysis) return;
    setIsExitingInterview(true);
    setInterviewError(null);
    setNoAnswerWarning(null);

    try {
      const res = await exitInterview(analysis.sessionId, audioMode);
      setInterviewLog(res.log);
      setLatestTurn(res.latestTurn);
      setScorecard({
        scored: res.scored ?? 0,
        total: res.total ?? res.log.length * 10,
        percentage: res.percentage ?? 0,
        audioUrl: res.audioUrl,
        report: res.report ?? '',
        log: res.log,
        maxQ: res.maxQ,
        exitedEarly: res.exitedEarly ?? true,
      });
    } catch {
      const answered = interviewLog.length;
      const scored = interviewLog.reduce((sum, item) => sum + item.mark, 0);
      const total = answered * 10;
      const percentage = total > 0 ? Math.round((scored / total) * 10000) / 100 : 0;
      const lines = [
        `FINAL SCORECARD: ${scored}/${total} (${percentage}%)`,
        `Questions Answered: ${answered} of ${maxQ}`,
        '',
        ...(answered === 0
          ? ['No questions were answered before exiting the interview.']
          : interviewLog.map(
              (item) =>
                `Q${item.step}: ${item.q}\nAnswer: ${item.ans}\nScore: ${item.mark}/10 | ${item.note}\n`
            )),
      ];

      setScorecard({
        scored,
        total,
        percentage,
        audioUrl: null,
        report: lines.join('\n'),
        log: interviewLog,
        maxQ,
        exitedEarly: true,
      });
    } finally {
      setInterviewActive(false);
      setCurrentStep('scorecard');
      setIsExitingInterview(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F3F6FB] text-slate-900">
      <StepperHeader onNavigate={handleNavigate} />

      <div className="flex-1 flex flex-col md:flex-row">
        <SidebarNav
          currentStep={currentStep}
          hasAnalysis={Boolean(analysis)}
          hasInterviewStarted={interviewActive}
          hasScorecard={Boolean(scorecard)}
          onNavigate={handleNavigate}
        />

        <main className="flex-1 min-w-0 flex flex-col">
          {currentStep === 'upload' && (
            <ResumeUploadStep
              initialRole={analysis?.role || ''}
              isLoading={isAnalyzing}
              error={uploadError}
              onSubmit={handleAnalyzeSubmit}
            />
          )}

          {currentStep === 'analysis' && analysis && (
            <AnalysisDashboardStep
              analysis={analysis}
              audioMode={audioMode}
              onAudioModeChange={setAudioMode}
              isStartingInterview={isStartingInterview}
              error={analysisError}
              onStartInterview={handleStartInterview}
              onBackToUpload={() => setCurrentStep('upload')}
            />
          )}

          {currentStep === 'interview' && analysis && interviewActive && (
            <InterviewRoomStep
              sessionId={analysis.sessionId}
              role={analysis.role}
              step={interviewStep}
              maxQ={maxQ}
              question={currentQuestion}
              audioUrl={currentAudioUrl}
              audioMode={audioMode}
              onAudioModeChange={setAudioMode}
              onAudioUrlReady={setCurrentAudioUrl}
              latestTurn={latestTurn}
              log={interviewLog}
              noAnswerWarning={noAnswerWarning}
              error={interviewError}
              isSubmitting={isSubmittingAnswer}
              isExiting={isExitingInterview}
              onSubmitAnswer={handleSubmitAnswer}
              onExitInterview={handleExitInterview}
            />
          )}

          {currentStep === 'scorecard' && analysis && scorecard && (
            <ScorecardStep
              role={analysis.role}
              filename={analysis.filename}
              scored={scorecard.scored}
              total={scorecard.total}
              percentage={scorecard.percentage}
              audioUrl={scorecard.audioUrl}
              report={scorecard.report}
              log={scorecard.log}
              maxQ={scorecard.maxQ}
              exitedEarly={scorecard.exitedEarly}
              onReset={handleReset}
            />
          )}
        </main>
      </div>

      <footer className="border-t border-slate-200/80 bg-white/80">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-3 text-xs text-slate-500">
          <span>KnowYou · Resume Analysis &amp; Mock Interview Platform</span>
          <span>Powered by Gemini</span>
        </div>
      </footer>
    </div>
  );
}
