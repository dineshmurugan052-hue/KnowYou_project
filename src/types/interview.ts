export type WorkflowStep = 'landing' | 'upload' | 'analysis' | 'interview' | 'scorecard';

export interface ParsedAnalysis {
  atsScore: number | null;
  atsSection: string;
  missingSkillsSection: string;
  improvementSection: string;
}

export interface AnalyzeResponse {
  sessionId: string;
  filename: string;
  role: string;
  report: string;
  parsed: ParsedAnalysis;
}

export interface InterviewLogItem {
  step: number;
  q: string;
  ans: string;
  mark: number;
  note: string;
}

export interface StartInterviewResponse {
  sessionId: string;
  role: string;
  step: number;
  maxQ: number;
  question: string;
  qView: string;
  audioUrl: string | null;
  log: InterviewLogItem[];
}

export interface AnswerInterviewResponse {
  sessionId: string;
  completed: boolean;
  exitedEarly?: boolean;
  noAnswer: boolean;
  step: number;
  maxQ: number;
  question?: string;
  qView: string;
  audioUrl: string | null;
  info?: string;
  report?: string;
  latestTurn: InterviewLogItem | null;
  scored?: number;
  total?: number;
  percentage?: number;
  log: InterviewLogItem[];
}
