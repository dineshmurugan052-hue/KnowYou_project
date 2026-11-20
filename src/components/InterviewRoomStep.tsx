import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Mic,
  Square,
  RotateCcw,
  Send,
  Volume2,
  VolumeX,
  Play,
  Pause,
  Loader2,
  AlertCircle,
  User,
  ChevronDown,
  ChevronUp,
  LogOut,
} from 'lucide-react';
import { startWavRecording, type WavRecorderHandle } from '../utils/wavEncoder';
import { speakQuestionAudio } from '../services/api';
import type { InterviewLogItem } from '../types/interview';

interface InterviewRoomStepProps {
  sessionId: string;
  role: string;
  step: number;
  maxQ: number;
  question: string;
  audioUrl: string | null;
  audioMode: boolean;
  onAudioModeChange: (enabled: boolean) => void;
  onAudioUrlReady: (url: string | null) => void;
  latestTurn: InterviewLogItem | null;
  log: InterviewLogItem[];
  noAnswerWarning: string | null;
  error: string | null;
  isSubmitting: boolean;
  isExiting: boolean;
  onSubmitAnswer: (boxText: string, micWav: Blob | null) => Promise<boolean>;
  onExitInterview: () => Promise<void>;
}

const SPEED_OPTIONS = [1, 1.25, 1.5] as const;

function formatSeconds(sec: number): string {
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export const InterviewRoomStep: React.FC<InterviewRoomStepProps> = ({
  sessionId,
  role,
  step,
  maxQ,
  question,
  audioUrl,
  audioMode,
  onAudioModeChange,
  onAudioUrlReady,
  latestTurn,
  log,
  noAnswerWarning,
  error,
  isSubmitting,
  isExiting,
  onSubmitAnswer,
  onExitInterview,
}) => {
  const [boxText, setBoxText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedPreviewUrl, setRecordedPreviewUrl] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  // Question Audio Mode states
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<(typeof SPEED_OPTIONS)[number]>(1);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const [serverAudioFailed, setServerAudioFailed] = useState(false);

  const recorderRef = useRef<WavRecorderHandle | null>(null);
  const timerRef = useRef<number | null>(null);
  const levelRafRef = useRef<number | null>(null);
  const interviewerAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeSpeechRef = useRef<SpeechSynthesisUtterance | null>(null);

  const stopAllInterviewerAudio = useCallback(() => {
    if (interviewerAudioRef.current) {
      interviewerAudioRef.current.pause();
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    activeSpeechRef.current = null;
    setIsSpeaking(false);
  }, []);

  const speakWithBrowserFallback = useCallback(
    (textToSpeak: string, rate: number) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        setIsSpeaking(false);
        return false;
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      utterance.lang = 'en-US';
      utterance.rate = rate;
      utterance.onstart = () => {
        setIsSpeaking(true);
        setAutoplayBlocked(false);
      };
      utterance.onend = () => {
        setIsSpeaking(false);
        activeSpeechRef.current = null;
      };
      utterance.onerror = () => {
        setIsSpeaking(false);
        activeSpeechRef.current = null;
      };
      activeSpeechRef.current = utterance;
      window.speechSynthesis.speak(utterance);
      return true;
    },
    []
  );

  // Keep HTMLAudioElement playbackRate synced
  useEffect(() => {
    if (interviewerAudioRef.current) {
      interviewerAudioRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  // Reset serverAudioFailed whenever a fresh audioUrl arrives
  useEffect(() => {
    setServerAudioFailed(false);
    setAutoplayBlocked(false);
  }, [audioUrl, question]);

  // Auto-play interviewer audio (or browser speech fallback) whenever question/audioUrl updates and audioMode is ON
  useEffect(() => {
    if (!audioMode) {
      stopAllInterviewerAudio();
      return;
    }

    if (audioUrl && !serverAudioFailed && interviewerAudioRef.current) {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      const audioEl = interviewerAudioRef.current;
      audioEl.playbackRate = playbackSpeed;
      audioEl.load();
      audioEl
        .play()
        .then(() => {
          setAutoplayBlocked(false);
        })
        .catch(() => {
          setAutoplayBlocked(true);
          setIsSpeaking(false);
        });
      return;
    }

    // If audioMode is ON but no server TTS audioUrl was returned (or server audio failed), speak via browser TTS
    if (question && (!audioUrl || serverAudioFailed)) {
      speakWithBrowserFallback(`Question ${step}. ${question}`, playbackSpeed);
    }
  }, [
    audioMode,
    audioUrl,
    question,
    step,
    serverAudioFailed,
    playbackSpeed,
    speakWithBrowserFallback,
    stopAllInterviewerAudio,
  ]);

  // Clean up preview blob URLs when replaced or removed
  useEffect(() => {
    return () => {
      if (recordedPreviewUrl) URL.revokeObjectURL(recordedPreviewUrl);
    };
  }, [recordedPreviewUrl]);

  // Clean up timers, animation frames, active microphone stream, and interviewer audio on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (levelRafRef.current) window.cancelAnimationFrame(levelRafRef.current);
      recorderRef.current?.cancel();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const handleToggleAudioMode = async () => {
    const nextEnabled = !audioMode;
    onAudioModeChange(nextEnabled);

    if (!nextEnabled) {
      stopAllInterviewerAudio();
      return;
    }

    // Turning Audio Mode ON mid-question: if we already have server audio, play it; else generate or use speech fallback
    if (audioUrl && !serverAudioFailed && interviewerAudioRef.current) {
      interviewerAudioRef.current.playbackRate = playbackSpeed;
      interviewerAudioRef.current
        .play()
        .then(() => setAutoplayBlocked(false))
        .catch(() => setAutoplayBlocked(true));
      return;
    }

    if (question) {
      setIsGeneratingAudio(true);
      try {
        const res = await speakQuestionAudio(sessionId, `Question ${step}. ${question}`);
        if (res.audioUrl) {
          onAudioUrlReady(res.audioUrl);
        } else {
          speakWithBrowserFallback(`Question ${step}. ${question}`, playbackSpeed);
        }
      } catch {
        speakWithBrowserFallback(`Question ${step}. ${question}`, playbackSpeed);
      } finally {
        setIsGeneratingAudio(false);
      }
    }
  };

  const handlePlayOrPauseQuestion = async () => {
    if (!audioMode) {
      onAudioModeChange(true);
    }

    // If currently speaking via <audio>
    if (audioUrl && !serverAudioFailed && interviewerAudioRef.current) {
      const audioEl = interviewerAudioRef.current;
      if (!audioEl.paused && !audioEl.ended) {
        audioEl.pause();
        setIsSpeaking(false);
        return;
      }
      if (audioEl.ended) {
        audioEl.currentTime = 0;
      }
      audioEl.playbackRate = playbackSpeed;
      audioEl
        .play()
        .then(() => setAutoplayBlocked(false))
        .catch(() => {
          setServerAudioFailed(true);
          speakWithBrowserFallback(`Question ${step}. ${question}`, playbackSpeed);
        });
      return;
    }

    // Otherwise toggle browser SpeechSynthesis
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        setIsSpeaking(false);
        return;
      }
    }

    // Try on-demand Gemini TTS if no server audio yet; fallback to browser speech
    if (!audioUrl && !serverAudioFailed) {
      setIsGeneratingAudio(true);
      try {
        const res = await speakQuestionAudio(sessionId, `Question ${step}. ${question}`);
        if (res.audioUrl) {
          onAudioUrlReady(res.audioUrl);
          return;
        }
      } catch {
        // Fall through to browser speech
      } finally {
        setIsGeneratingAudio(false);
      }
    }

    speakWithBrowserFallback(`Question ${step}. ${question}`, playbackSpeed);
  };

  const handleReplayQuestion = () => {
    if (!audioMode) {
      onAudioModeChange(true);
    }

    if (audioUrl && !serverAudioFailed && interviewerAudioRef.current) {
      const audioEl = interviewerAudioRef.current;
      audioEl.currentTime = 0;
      audioEl.playbackRate = playbackSpeed;
      audioEl
        .play()
        .then(() => setAutoplayBlocked(false))
        .catch(() => {
          speakWithBrowserFallback(`Question ${step}. ${question}`, playbackSpeed);
        });
      return;
    }

    speakWithBrowserFallback(`Question ${step}. ${question}`, playbackSpeed);
  };

  const clearRecording = () => {
    if (recordedPreviewUrl) URL.revokeObjectURL(recordedPreviewUrl);
    setRecordedBlob(null);
    setRecordedPreviewUrl(null);
    setRecordSeconds(0);
    setMicLevel(0);
  };

  const handleStartRecording = async () => {
    // Pause interviewer voice while candidate is speaking into the mic
    stopAllInterviewerAudio();
    setMicError(null);
    clearRecording();
    try {
      const handle = await startWavRecording();
      recorderRef.current = handle;
      setIsRecording(true);
      setRecordSeconds(0);

      timerRef.current = window.setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);

      const updateLevel = () => {
        if (recorderRef.current) {
          setMicLevel(recorderRef.current.getLevel());
          levelRafRef.current = window.requestAnimationFrame(updateLevel);
        }
      };
      levelRafRef.current = window.requestAnimationFrame(updateLevel);
    } catch (err) {
      setMicError(
        err instanceof Error
          ? err.message
          : 'Unable to access microphone. Check browser permissions or type your answer below.'
      );
    }
  };

  const handleStopRecording = async () => {
    if (!recorderRef.current) return;
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (levelRafRef.current) {
      window.cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    }

    const wavBlob = await recorderRef.current.stop();
    recorderRef.current = null;
    setIsRecording(false);
    setMicLevel(0);
    setRecordedBlob(wavBlob);
    setRecordedPreviewUrl(URL.createObjectURL(wavBlob));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRecording) {
      await handleStopRecording();
      return;
    }
    stopAllInterviewerAudio();
    const accepted = await onSubmitAnswer(boxText, recordedBlob);
    if (accepted) {
      setBoxText('');
      clearRecording();
    }
  };

  const handleExitClick = async () => {
    stopAllInterviewerAudio();
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (levelRafRef.current) {
      window.cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    }
    if (isRecording) {
      recorderRef.current?.cancel();
      recorderRef.current = null;
      setIsRecording(false);
      setMicLevel(0);
    }
    await onExitInterview();
  };

  const progressPct = Math.min(100, Math.round(((step - 1) / maxQ) * 100));

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      {/* Header & Progress */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-slate-200">
        <div>
          <p className="text-xs font-medium text-slate-500">
            <span>Step 03</span>
            <span aria-hidden="true"> · </span>
            <span>Interactive Mock Interview</span>
            <span aria-hidden="true"> · </span>
            <span>{role}</span>
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            Interview Room
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-4 w-full sm:w-auto">
          <div className="w-full sm:w-56">
            <div className="flex items-center justify-between text-xs font-medium text-slate-700">
              <span>Question Progress</span>
              <span className="font-mono tabular-nums">
                {Math.min(step, maxQ)} / {maxQ}
              </span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-[#3544B8] transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={handleExitClick}
            disabled={isSubmitting || isExiting}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:border-red-300 hover:bg-red-50 hover:text-red-700 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isExiting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                <span>Ending...</span>
              </>
            ) : (
              <>
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Exit Interview</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-12">
        {/* Left Column: Interviewer Prompt + Voice & Text Answer Controls */}
        <div className="lg:col-span-7 space-y-6">
          {/* Interviewer Question Card (Text + Audio Mode) */}
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-start gap-4">
              <div
                className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border bg-slate-100 flex items-center justify-center transition-all ${
                  isSpeaking
                    ? 'border-[#3544B8] ring-2 ring-[#3544B8]/25'
                    : 'border-slate-200'
                }`}
              >
                {!imgFailed ? (
                  <img
                    src="/src/assets/images/interviewer_portrait_1795112646540.jpg"
                    alt="Technical Interviewer"
                    referrerPolicy="no-referrer"
                    onError={() => setImgFailed(true)}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <User className="h-6 w-6 text-slate-500" aria-hidden="true" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-[#3544B8] tabular-nums">
                      Question {step} of {maxQ}
                    </span>
                    {isSpeaking && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#3544B8]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#3544B8] animate-pulse" />
                        Speaking
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleToggleAudioMode}
                    disabled={isGeneratingAudio}
                    aria-pressed={audioMode}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50 ${
                      audioMode
                        ? 'border-[#C5D1F7] bg-[#E7ECFB] text-[#2E3BB8] hover:bg-[#dce4fa]'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {audioMode ? (
                      <>
                        <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Audio Mode: On</span>
                      </>
                    ) : (
                      <>
                        <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Audio Mode: Off</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Question Text */}
                <p className="mt-2.5 text-base font-medium leading-relaxed text-slate-900">
                  {question}
                </p>
              </div>
            </div>

            {/* Integrated Audio Mode Control Bar */}
            {audioMode && (
              <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50/90 p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handlePlayOrPauseQuestion}
                      disabled={isGeneratingAudio}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#3544B8] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#2B389B] transition-colors cursor-pointer disabled:opacity-60"
                    >
                      {isGeneratingAudio ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          <span>Generating Voice...</span>
                        </>
                      ) : isSpeaking ? (
                        <>
                          <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Pause</span>
                        </>
                      ) : (
                        <>
                          <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                          <span>{autoplayBlocked ? 'Play Question Audio' : 'Listen'}</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleReplayQuestion}
                      disabled={isGeneratingAudio}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Replay</span>
                    </button>
                  </div>

                  {/* Playback Speed */}
                  <div className="flex items-center gap-1">
                    {SPEED_OPTIONS.map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        onClick={() => setPlaybackSpeed(rate)}
                        className={`rounded-md px-2 py-1 font-mono text-[11px] font-semibold transition-colors cursor-pointer ${
                          playbackSpeed === rate
                            ? 'bg-slate-800 text-white'
                            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {rate}x
                      </button>
                    ))}
                  </div>
                </div>

                {audioUrl && !serverAudioFailed ? (
                  <audio
                    ref={interviewerAudioRef}
                    controls
                    src={audioUrl}
                    onPlay={() => {
                      setIsSpeaking(true);
                      setAutoplayBlocked(false);
                    }}
                    onPause={() => setIsSpeaking(false)}
                    onEnded={() => setIsSpeaking(false)}
                    onError={() => {
                      setServerAudioFailed(true);
                      setIsSpeaking(false);
                    }}
                    className="h-9 w-full"
                  />
                ) : (
                  <p className="text-xs text-slate-500">
                    {isGeneratingAudio
                      ? 'Preparing interviewer voice audio...'
                      : 'Voice playback active via browser speech synthesis. Click Listen or Replay anytime.'}
                  </p>
                )}
              </div>
            )}
          </section>

          {/* Candidate Answer Interface */}
          <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-6 space-y-6">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Your Answer</h2>
              <p className="mt-1 text-xs text-slate-500">
                Record your voice via microphone or type your response below. Text takes priority if
                both are provided.
              </p>
            </div>

            {/* Voice Recording Section */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">Voice Answer (Microphone)</p>
                  <p className="text-xs text-slate-500">
                    Recorded as WAV for Gemini voice transcription
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {!isRecording ? (
                    <button
                      type="button"
                      disabled={isSubmitting || isExiting}
                      onClick={handleStartRecording}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
                    >
                      <Mic className="h-3.5 w-3.5 text-red-600" aria-hidden="true" />
                      <span>{recordedBlob ? 'Re-record' : 'Start Recording'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isExiting}
                      onClick={handleStopRecording}
                      className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-red-700 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
                    >
                      <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                      <span>Stop ({formatSeconds(recordSeconds)})</span>
                    </button>
                  )}

                  {recordedBlob && !isRecording && (
                    <button
                      type="button"
                      disabled={isSubmitting || isExiting}
                      onClick={clearRecording}
                      aria-label="Discard voice recording"
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Clear</span>
                    </button>
                  )}
                </div>
              </div>

              {isRecording && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-red-700 font-medium">
                    <span>Recording microphone input...</span>
                    <span className="font-mono tabular-nums">{formatSeconds(recordSeconds)}</span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-red-600 transition-all duration-75"
                      style={{ width: `${Math.max(8, Math.round(micLevel * 100))}%` }}
                    />
                  </div>
                </div>
              )}

              {recordedPreviewUrl && !isRecording && (
                <div className="mt-3 flex items-center gap-3 pt-3 border-t border-slate-200">
                  <span className="text-xs font-medium text-emerald-700 whitespace-nowrap">
                    Voice clip ready ({formatSeconds(recordSeconds)})
                  </span>
                  <audio controls src={recordedPreviewUrl} className="h-8 flex-1" />
                </div>
              )}

              {micError && (
                <p className="mt-3 text-xs text-red-700">{micError}</p>
              )}
            </div>

            {/* Text Answer Section */}
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="text-answer-box" className="text-sm font-medium text-slate-900">
                  Text Answer
                </label>
                <span className="font-mono text-xs text-slate-400 tabular-nums">
                  {boxText.length} chars
                </span>
              </div>
              <textarea
                id="text-answer-box"
                rows={4}
                disabled={isSubmitting || isExiting}
                value={boxText}
                onChange={(e) => setBoxText(e.target.value)}
                placeholder="Type your answer here..."
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-[#3544B8] focus:outline-none focus:ring-2 focus:ring-[#3544B8]/15 disabled:bg-slate-50"
              />
            </div>

            {(noAnswerWarning || error) && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
              >
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-700" aria-hidden="true" />
                <span>{error || noAnswerWarning}</span>
              </div>
            )}

            <div className="flex items-center justify-end pt-2 border-t border-slate-100">
              <button
                type="submit"
                disabled={isSubmitting || isRecording || isExiting}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#3B49DF] to-[#2E3BB8] px-6 py-2.5 text-sm font-semibold text-white hover:from-[#3340C9] hover:to-[#26319F] transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Evaluating Answer...</span>
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" aria-hidden="true" />
                    <span>{step === maxQ ? 'Submit Final Answer' : 'Submit Answer'}</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Right Column: Latest Evaluation + Session Log */}
        <aside className="lg:col-span-5 space-y-6">
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-sm font-semibold text-slate-900 pb-3 border-b border-slate-100">
              Latest Answer Evaluation
            </h2>

            {latestTurn ? (
              <div className="mt-4 space-y-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-medium text-slate-500 font-mono tabular-nums">
                    Question {latestTurn.step}
                  </span>
                  <div className="flex items-baseline gap-1">
                    <span
                      className={`font-mono text-2xl font-bold tabular-nums ${
                        latestTurn.mark >= 7
                          ? 'text-emerald-700'
                          : latestTurn.mark >= 4
                            ? 'text-amber-700'
                            : 'text-red-700'
                      }`}
                    >
                      {latestTurn.mark}
                    </span>
                    <span className="font-mono text-xs text-slate-400 tabular-nums">/ 10</span>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-medium text-slate-500">Captured Answer</p>
                  <p className="mt-1 text-sm text-slate-800 leading-relaxed">{latestTurn.ans}</p>
                </div>

                <div>
                  <p className="text-xs font-medium text-slate-500">Interviewer Feedback</p>
                  <p className="mt-1 text-sm text-slate-700 leading-relaxed">{latestTurn.note}</p>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-500 leading-relaxed">
                Submit your answer to Question 1 to view real-time marks and evaluation notes from
                the interviewer.
              </p>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-900">Completed Questions</h2>
              <span className="font-mono text-xs text-slate-500 tabular-nums">
                {log.length} logged
              </span>
            </div>

            {log.length === 0 ? (
              <p className="mt-4 text-xs text-slate-500">No questions graded yet in this session.</p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100 max-h-[380px] overflow-y-auto">
                {[...log].reverse().map((item) => {
                  const isOpen = expandedStep === item.step;
                  return (
                    <li key={item.step} className="py-3">
                      <button
                        type="button"
                        onClick={() => setExpandedStep(isOpen ? null : item.step)}
                        className="w-full flex items-center justify-between gap-3 text-left cursor-pointer"
                      >
                        <div className="min-w-0">
                          <span className="font-mono text-xs font-semibold text-slate-500 tabular-nums">
                            Q{item.step}
                          </span>
                          <p className="truncate text-xs font-medium text-slate-800">{item.q}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                            {item.mark}/10
                          </span>
                          {isOpen ? (
                            <ChevronUp className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                          )}
                        </div>
                      </button>

                      {isOpen && (
                        <div className="mt-2 space-y-1.5 text-xs text-slate-600 pl-1">
                          <p>
                            <span className="font-medium text-slate-800">Answer:</span> {item.ans}
                          </p>
                          <p>
                            <span className="font-medium text-slate-800">Feedback:</span> {item.note}
                          </p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
};
