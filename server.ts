import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { Chat, Part } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IS_PROD = process.env.NODE_ENV === 'production';
const PORT =
  !IS_PROD && process.env.DEFAULT_APP_PORT
    ? Number(process.env.DEFAULT_APP_PORT)
    : Number(process.env.PORT) || 3000;

const TEXT_MODEL = 'gemini-3.1-flash-lite';
const TRANSCRIBE_MODEL = 'gemini-3.5-transcribe';
const TTS_MODEL = 'gemini-3.8-flash-lite-tts';

const ALLOWED_RESUME_EXTENSIONS = new Set([
  '.txt',
  '.pdf',
  '.docx',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
]);

const MAX_SESSIONS = 100;

interface InterviewLogItem {
  step: number;
  q: string;
  ans: string;
  mark: number;
  note: string;
}

interface AudioAsset {
  buffer: Buffer;
  mimeType: string;
}

interface SessionState {
  sessionId: string;
  filename: string;
  role: string;
  resumePart: Part;
  report: string;
  maxQ: number;
  chat: Chat | null;
  interview: {
    step: number;
    q: string;
    log: InterviewLogItem[];
  } | null;
  audioFiles: Map<string, AudioAsset>;
}

class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

const sessions = new Map<string, SessionState>();

function storeSession(sessionId: string, state: SessionState) {
  while (sessions.size >= MAX_SESSIONS) {
    const oldestKey = sessions.keys().next().value;
    if (oldestKey) {
      sessions.delete(oldestKey);
    } else {
      break;
    }
  }
  sessions.set(sessionId, state);
}

let cachedGeminiKey: string | null = null;
let cachedGeminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new HttpError(
      500,
      'GEMINI_API_KEY is not configured. Please add a valid Gemini API key in Settings > Secrets.'
    );
  }
  if (!cachedGeminiClient || cachedGeminiKey !== apiKey) {
    cachedGeminiKey = apiKey;
    cachedGeminiClient = new GoogleGenAI({
      apiKey,
      apiVersion: 'v1beta',
      httpOptions: {
        timeout: 25000,
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedGeminiClient;
}

function extractStatusCode(err: unknown): number {
  if (err instanceof HttpError) return err.statusCode;
  const anyErr = err as { status?: number; code?: number; statusCode?: number; message?: string };
  const numeric = anyErr?.status ?? anyErr?.statusCode ?? anyErr?.code;
  if (typeof numeric === 'number' && numeric >= 400 && numeric < 600) {
    return numeric;
  }
  const msg = String(anyErr?.message ?? err ?? '');
  if (msg.includes('503') || msg.includes('UNAVAILABLE')) return 503;
  if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) return 429;
  if (msg.includes('403') || msg.includes('PERMISSION_DENIED')) return 403;
  if (msg.includes('400') || msg.includes('INVALID_ARGUMENT') || msg.includes('API_KEY_INVALID')) {
    return 400;
  }
  if (msg.includes('404') || msg.includes('NOT_FOUND')) return 404;
  return 500;
}

function isTransientError(err: unknown): boolean {
  const anyErr = err as { status?: number; code?: number; statusCode?: number; name?: string; message?: string };
  if (anyErr?.name === 'AbortError' || anyErr?.name === 'TimeoutError') return false;
  const numeric = anyErr?.status ?? anyErr?.statusCode ?? anyErr?.code;
  if (numeric === 502 || numeric === 503 || numeric === 504) return true;
  const msg = String(anyErr?.message ?? err ?? '').toUpperCase();
  return msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('HIGH DEMAND') || msg.includes('OVERLOADED');
}

async function withRetry<T>(fn: () => Promise<T>, canRetry?: () => boolean): Promise<T> {
  const delays = [1000];
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const shouldRetry =
        attempt < delays.length && isTransientError(err) && (!canRetry || canRetry());
      if (!shouldRetry) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
  throw lastError;
}

function toCleanHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  const status = extractStatusCode(err);
  const rawMessage = err instanceof Error ? err.message : String(err || 'Unexpected server error.');

  if (status === 503) {
    return new HttpError(
      503,
      `The ${TEXT_MODEL} model is temporarily experiencing high demand (503 UNAVAILABLE). Please wait a moment and try again.`
    );
  }
  if (status === 429) {
    return new HttpError(
      429,
      'Gemini API quota exceeded (429 RESOURCE_EXHAUSTED). Wait a moment or select a billing-enabled API key in Settings > Secrets.'
    );
  }
  if (status === 403 || rawMessage.includes('API_KEY_INVALID')) {
    return new HttpError(
      status === 403 ? 403 : 400,
      'The configured Gemini API key was rejected. Please verify your key in Settings > Secrets.'
    );
  }
  return new HttpError(status, rawMessage);
}

async function extractResumePart(file: Express.Multer.File): Promise<Part> {
  const filename = file.originalname || 'resume.txt';
  const ext = path.extname(filename).toLowerCase();

  if (!ALLOWED_RESUME_EXTENSIONS.has(ext)) {
    throw new HttpError(
      400,
      'Unsupported file format. Upload PDF, DOCX, TXT, PNG, JPG, JPEG, or WEBP.'
    );
  }

  if (!file.buffer || file.buffer.length === 0) {
    throw new HttpError(400, 'The uploaded resume file is empty.');
  }

  if (ext === '.txt') {
    const text = file.buffer.toString('utf-8').trim();
    if (!text) {
      throw new HttpError(400, 'Could not extract readable text from the uploaded resume.');
    }
    return { text };
  }

  if (ext === '.docx') {
    try {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      const text = (result.value || '').trim();
      if (!text) {
        throw new HttpError(400, 'Could not extract readable text from the uploaded DOCX resume.');
      }
      return { text };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(
        400,
        'Could not parse the uploaded DOCX file. Please ensure it is a valid .docx document.'
      );
    }
  }

  const mimeMap: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  };

  return {
    inlineData: {
      mimeType: mimeMap[ext] || 'application/octet-stream',
      data: file.buffer.toString('base64'),
    },
  };
}

function parseAnalysisSections(reportText: string) {
  const scoreMatch = reportText.match(/(\d{1,3})\s*(?:\/|out of)\s*100/i);
  let atsScore: number | null = scoreMatch ? parseInt(scoreMatch[1], 10) : null;
  if (atsScore !== null && Number.isFinite(atsScore)) {
    atsScore = Math.max(0, Math.min(100, atsScore));
  } else {
    atsScore = null;
  }

  const buckets: Record<'atsSection' | 'missingSkillsSection' | 'improvementSection', string[]> = {
    atsSection: [],
    missingSkillsSection: [],
    improvementSection: [],
  };

  let currentKey: 'atsSection' | 'missingSkillsSection' | 'improvementSection' | null = null;
  for (const line of reportText.split(/\r?\n/)) {
    const low = line.trim().toLowerCase();
    if (
      /^(?:#{1,4}\s*)?(?:\*{0,2})?1[.):]?\s*ats\b/.test(low) ||
      (low.includes('ats score') && low.length < 70)
    ) {
      currentKey = 'atsSection';
    } else if (
      /^(?:#{1,4}\s*)?(?:\*{0,2})?2[.):]?\s*missing\s*skill/.test(low) ||
      (low.includes('missing skill') && low.length < 70)
    ) {
      currentKey = 'missingSkillsSection';
    } else if (
      /^(?:#{1,4}\s*)?(?:\*{0,2})?3[.):]?\s*improvement/.test(low) ||
      (low.includes('improvement in topics') && low.length < 70)
    ) {
      currentKey = 'improvementSection';
    }

    if (currentKey) {
      buckets[currentKey].push(line);
    }
  }

  return {
    atsScore,
    atsSection: buckets.atsSection.join('\n').trim(),
    missingSkillsSection: buckets.missingSkillsSection.join('\n').trim(),
    improvementSection: buckets.improvementSection.join('\n').trim(),
  };
}

function ensureWavBuffer(raw: Buffer, mimeType?: string): { buffer: Buffer; mimeType: string } {
  const isRiff =
    raw.length >= 12 &&
    raw.toString('ascii', 0, 4) === 'RIFF' &&
    raw.toString('ascii', 8, 12) === 'WAVE';

  if (isRiff) {
    return { buffer: raw, mimeType: 'audio/wav' };
  }

  const lowerMime = (mimeType || '').toLowerCase();
  if (lowerMime.includes('mpeg') || lowerMime.includes('mp3') || lowerMime.includes('ogg')) {
    return { buffer: raw, mimeType: mimeType || 'audio/mpeg' };
  }

  // Wrap raw 24kHz mono 16-bit PCM into a standard RIFF WAV container
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + raw.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(raw.length, 40);

  return {
    buffer: Buffer.concat([header, raw]),
    mimeType: 'audio/wav',
  };
}

async function safeGenerateSpeech(
  ai: GoogleGenAI,
  text: string
): Promise<{ asset: AudioAsset | null; error?: string }> {
  const plain = text.replace(/[*#`]/g, '').replace(/\s+/g, ' ').trim();
  if (!plain) return { asset: null };

  const attemptTts = async (mode: 'full' | 'voiceOnly' | 'minimal') => {
    const part =
      mode === 'full'
        ? {
            text: plain,
            speechMetadata: {
              style: 'Clear, professional technical interviewer',
            },
          }
        : { text: plain };

    const config =
      mode === 'minimal'
        ? {
            responseModalities: ['AUDIO'],
          }
        : {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Kore' },
              },
            },
          };

    const response = await ai.models.generateContent({
      model: TTS_MODEL,
      contents: [
        {
          role: 'user',
          parts: [part],
        },
      ],
      config,
    });

    const parts = response.candidates?.[0]?.content?.parts || [];
    const audioPart = parts.find((p) => p.inlineData?.data);
    const inlineData = audioPart?.inlineData;
    if (!inlineData?.data) return null;

    const decoded = Buffer.from(inlineData.data, 'base64');
    return ensureWavBuffer(decoded, inlineData.mimeType);
  };

  let lastMsg = '';
  for (const mode of ['full', 'voiceOnly', 'minimal'] as const) {
    try {
      const asset = await attemptTts(mode);
      if (asset) return { asset };
    } catch (err) {
      lastMsg = err instanceof Error ? err.message : String(err);
    }
  }
  console.warn('[tts] Audio generation skipped:', lastMsg);
  return { asset: null, error: lastMsg };
}

async function transcribeAudioAnswer(
  ai: GoogleGenAI,
  audioBuffer: Buffer,
  mimeType: string
): Promise<string> {
  const response = await withRetry(() =>
    ai.models.generateContent({
      model: TRANSCRIBE_MODEL,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType || 'audio/wav',
              data: audioBuffer.toString('base64'),
            },
          },
          {
            text: 'Transcribe this spoken technical interview answer accurately. Return only the spoken words with no extra commentary. If there is only silence or no intelligible speech, return an empty string.',
          },
        ],
      },
    })
  );

  return (response.text || '').trim();
}

function parseEvalJson(rawText: string): {
  marks?: unknown;
  analysis?: unknown;
  next_question?: unknown;
} {
  let text = (rawText || '').trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === 'object') {
      return parsed[0];
    }
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
}

function normalizeMark(raw: unknown): number {
  const num = Number(raw);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(10, Math.round(num)));
}

function buildFinalReport(log: InterviewLogItem[], maxQ: number, exitedEarly: boolean) {
  const answered = log.length;
  const scored = log.reduce((sum, item) => sum + item.mark, 0);
  const total = (exitedEarly ? answered : maxQ) * 10;
  const percentage = total > 0 ? Math.round((scored / total) * 10000) / 100 : 0;

  let report = `FINAL SCORECARD: ${scored}/${total} (${percentage}%)\n`;
  if (exitedEarly) {
    report += `Questions Answered: ${answered} of ${maxQ}\n\n`;
  } else {
    report += '\n';
  }

  if (answered === 0) {
    report += 'No questions were answered before exiting the interview.\n';
  } else {
    for (const item of log) {
      report += `Q${item.step}: ${item.q}\nAnswer: ${item.ans}\nScore: ${item.mark}/10 | ${item.note}\n\n`;
    }
  }

  return { scored, total, percentage, report };
}

function createApiRouter() {
  const router = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 15 * 1024 * 1024, // 15 MB max
    },
  });

  router.use(express.json({ limit: '2mb' }));

  router.get('/health', (_req, res) => {
    res.json({ ok: true, model: TEXT_MODEL });
  });

  router.post(
    '/analyze',
    upload.single('file'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const cleanRole = String(req.body?.role || '').trim();
        if (!cleanRole) {
          throw new HttpError(400, 'Please enter a valid target job role.');
        }

        const file = req.file;
        if (!file) {
          throw new HttpError(400, 'Please upload a resume file before continuing.');
        }

        const resumePart = await extractResumePart(file);
        const ai = getGeminiClient();

        const prompt = `You are a technical recruiter and ATS resume reviewer.
Check the attached resume for the role: ${cleanRole}.

Give a clear report with these 3 sections:
1. ATS Score: Score out of 100 (formatted like "78/100") with a short reason.
2. Missing Skill Set: Important skills, tools, or frameworks for ${cleanRole} that are missing or weak.
3. Improvement in Topics: Specific technical topics, project updates, and resume sections to improve.`;

        const response = await withRetry(() =>
          ai.models.generateContent({
            model: TEXT_MODEL,
            contents: {
              parts: [{ text: prompt }, resumePart],
            },
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          })
        );

        const safeReport = (response.text || '').trim();
        if (!safeReport) {
          throw new HttpError(502, 'Gemini returned an empty analysis report. Please try again.');
        }

        const sessionId = crypto.randomUUID();
        const filename = file.originalname || 'resume';

        storeSession(sessionId, {
          sessionId,
          filename,
          role: cleanRole,
          resumePart,
          report: safeReport,
          maxQ: 10,
          chat: null,
          interview: null,
          audioFiles: new Map(),
        });

        res.json({
          sessionId,
          filename,
          role: cleanRole,
          report: safeReport,
          parsed: parseAnalysisSections(safeReport),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.post('/interview/start', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionId = String(req.body?.sessionId || '').trim();
      const rawMaxQ = Number(req.body?.maxQ ?? 10);
      const audioMode = req.body?.audioMode !== false;

      const state = sessions.get(sessionId);
      if (!state) {
        throw new HttpError(404, 'Session not found. Please upload your resume first.');
      }

      if (!Number.isInteger(rawMaxQ) || rawMaxQ < 1 || rawMaxQ > 25) {
        throw new HttpError(400, 'Number of questions must be between 1 and 25.');
      }

      const ai = getGeminiClient();
      const chat = ai.chats.create({
        model: TEXT_MODEL,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          systemInstruction:
            `You are a technical interviewer taking an interview for ${state.role}. ` +
            'Ask short, clear questions based only on the skills and projects in the resume. ' +
            'Keep questions plain for audio playback without markdown symbols or bullet points.',
        },
      });

      const q1Reply = await withRetry(() =>
        chat.sendMessage({
          message: [
            state.resumePart,
            {
              text: `Ask Question 1 of ${rawMaxQ} for ${state.role} from the resume skills. Give only the question.`,
            },
          ],
        })
      );

      const q1 =
        (q1Reply.text || '').trim() ||
        `Tell me about your most relevant project or technical experience for the ${state.role} role.`;

      state.maxQ = rawMaxQ;
      state.chat = chat;
      state.interview = { step: 1, q: q1, log: [] };
      state.audioFiles.clear();

      let audioUrl: string | null = null;
      if (audioMode) {
        const q1Audio = await safeGenerateSpeech(ai, `Question 1. ${q1}`);
        if (q1Audio.asset) {
          const audioName = `q_1_${Date.now()}.wav`;
          state.audioFiles.set(audioName, q1Audio.asset);
          audioUrl = `/api/audio/${sessionId}/${audioName}`;
        }
      }

      res.json({
        sessionId,
        role: state.role,
        step: 1,
        maxQ: state.maxQ,
        question: q1,
        qView: `Q1/${state.maxQ}: ${q1}`,
        audioUrl,
        log: state.interview.log,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/interview/speak', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionId = String(req.body?.sessionId || '').trim();
      const text = String(req.body?.text || '').trim();

      const state = sessions.get(sessionId);
      if (!state) {
        throw new HttpError(404, 'Session not found.');
      }

      const targetText = text || state.interview?.q || '';
      if (!targetText) {
        throw new HttpError(400, 'No question text available to synthesize.');
      }

      const ai = getGeminiClient();
      const audio = await safeGenerateSpeech(ai, targetText);
      let audioUrl: string | null = null;
      if (audio.asset) {
        const audioName = `speak_${Date.now()}_${crypto.randomBytes(3).toString('hex')}.wav`;
        state.audioFiles.set(audioName, audio.asset);
        audioUrl = `/api/audio/${sessionId}/${audioName}`;
      }

      res.json({ audioUrl, fallback: !audioUrl });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/interview/answer',
    upload.single('micFile'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const sessionId = String(req.body?.sessionId || '').trim();
        const boxText = String(req.body?.boxText || '');
        const audioMode = String(req.body?.audioMode ?? 'true') !== 'false';
        const micFile = req.file;

        const state = sessions.get(sessionId);
        if (!state || !state.interview || !state.chat) {
          throw new HttpError(404, 'Interview session not started.');
        }

        const interview = state.interview;
        if (interview.step > state.maxQ) {
          const summary = buildFinalReport(interview.log, state.maxQ, false);
          res.json({
            sessionId,
            completed: true,
            noAnswer: false,
            step: interview.step,
            maxQ: state.maxQ,
            qView: 'Interview Completed',
            audioUrl: null,
            report: summary.report,
            latestTurn: interview.log[interview.log.length - 1] ?? null,
            scored: summary.scored,
            total: summary.total,
            percentage: summary.percentage,
            log: interview.log,
          });
          return;
        }

        const ai = getGeminiClient();
        let ans = boxText.trim();
        if (!ans && micFile?.buffer && micFile.buffer.length > 0) {
          ans = await transcribeAudioAnswer(ai, micFile.buffer, micFile.mimetype || 'audio/wav');
        }

        if (!ans) {
          res.json({
            sessionId,
            completed: false,
            noAnswer: true,
            step: interview.step,
            maxQ: state.maxQ,
            question: interview.q,
            qView: `Q${interview.step}/${state.maxQ}: ${interview.q}`,
            audioUrl: null,
            info: 'No answer detected. Please record your voice or type your answer.',
            latestTurn: null,
            log: interview.log,
          });
          return;
        }

        const step = interview.step;
        const isLast = step === state.maxQ;
        const prevLogLen = interview.log.length;

        const checkPrompt = `Question ${step}: "${interview.q}"
Candidate Answer: "${ans}"

Grade out of 10 for ${state.role}.
Return JSON with:
- marks: integer 0 to 10
- analysis: 1 to 2 short spoken sentences of constructive feedback
- next_question: ${isLast ? '"DONE"' : `Ask Question ${step + 1} of ${state.maxQ} from the resume skills (plain text only, no markdown).`}`;

        const chat = state.chat;
        const reply = await withRetry(
          () =>
            chat.sendMessage({
              message: checkPrompt,
              config: {
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    marks: { type: Type.INTEGER },
                    analysis: { type: Type.STRING },
                    next_question: { type: Type.STRING },
                  },
                  required: ['marks', 'analysis', 'next_question'],
                },
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              },
            }),
          () => interview.log.length === prevLogLen
        );

        const parsed = parseEvalJson(reply.text || '{}');
        const mark = normalizeMark(parsed.marks);
        const note = String(parsed.analysis || '').trim() || 'Answer recorded.';

        const turn: InterviewLogItem = {
          step,
          q: interview.q,
          ans,
          mark,
          note,
        };
        interview.log.push(turn);

        if (isLast) {
          interview.step += 1;
          const summary = buildFinalReport(interview.log, state.maxQ, false);
          let audioUrl: string | null = null;
          if (audioMode) {
            const finalAudio = await safeGenerateSpeech(
              ai,
              `You scored ${mark} out of 10. Interview complete. Your total score is ${summary.scored} out of ${summary.total}.`
            );
            if (finalAudio.asset) {
              const audioName = `final_${Date.now()}.wav`;
              state.audioFiles.set(audioName, finalAudio.asset);
              audioUrl = `/api/audio/${sessionId}/${audioName}`;
            }
          }

          res.json({
            sessionId,
            completed: true,
            noAnswer: false,
            step: interview.step,
            maxQ: state.maxQ,
            qView: 'Interview Completed',
            audioUrl,
            report: summary.report,
            latestTurn: turn,
            scored: summary.scored,
            total: summary.total,
            percentage: summary.percentage,
            log: interview.log,
          });
          return;
        }

        let nextQ = String(parsed.next_question || '').trim();
        if (!nextQ || nextQ.toUpperCase() === 'DONE') {
          nextQ = `Walk me through a key technical decision you made in a project relevant to ${state.role}.`;
        }

        interview.step += 1;
        interview.q = nextQ;

        let audioUrl: string | null = null;
        if (audioMode) {
          const nextAudio = await safeGenerateSpeech(
            ai,
            `You scored ${mark} out of 10. ${note} Question ${interview.step}. ${nextQ}`
          );
          if (nextAudio.asset) {
            const audioName = `q_${interview.step}_${Date.now()}.wav`;
            state.audioFiles.set(audioName, nextAudio.asset);
            audioUrl = `/api/audio/${sessionId}/${audioName}`;
          }
        }

        res.json({
          sessionId,
          completed: false,
          noAnswer: false,
          step: interview.step,
          maxQ: state.maxQ,
          question: nextQ,
          qView: `Q${interview.step}/${state.maxQ}: ${nextQ}`,
          audioUrl,
          info: `Your Answer: ${ans}\nScore: ${mark}/10 - ${note}`,
          latestTurn: turn,
          log: interview.log,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  router.post('/interview/exit', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionId = String(req.body?.sessionId || '').trim();
      const audioMode = req.body?.audioMode !== false;
      const state = sessions.get(sessionId);
      if (!state || !state.interview) {
        throw new HttpError(404, 'Interview session not started.');
      }

      const interview = state.interview;
      interview.step = state.maxQ + 1;
      const summary = buildFinalReport(interview.log, state.maxQ, true);

      let audioUrl: string | null = null;
      if (audioMode) {
        try {
          const ai = getGeminiClient();
          const spokenSummary =
            interview.log.length === 0
              ? 'Interview ended before any questions were answered.'
              : `Interview ended. You answered ${interview.log.length} out of ${state.maxQ} questions. Your score is ${summary.scored} out of ${summary.total}.`;
          const endAudio = await safeGenerateSpeech(ai, spokenSummary);
          if (endAudio.asset) {
            const audioName = `exit_${Date.now()}.wav`;
            state.audioFiles.set(audioName, endAudio.asset);
            audioUrl = `/api/audio/${sessionId}/${audioName}`;
          }
        } catch {
          // Proceed with scorecard even if audio generation is unavailable
        }
      }

      res.json({
        sessionId,
        completed: true,
        exitedEarly: true,
        noAnswer: false,
        step: interview.step,
        maxQ: state.maxQ,
        qView: 'Interview Ended',
        audioUrl,
        report: summary.report,
        latestTurn: interview.log[interview.log.length - 1] ?? null,
        scored: summary.scored,
        total: summary.total,
        percentage: summary.percentage,
        log: interview.log,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/audio/:sessionId/:filename', (req: Request, res: Response) => {
    const sessionId = String(req.params.sessionId || '');
    const safeName = path.basename(String(req.params.filename || ''));
    const state = sessions.get(sessionId);
    if (!state) {
      res.status(404).json({ detail: 'Session not found.' });
      return;
    }

    const asset = state.audioFiles.get(safeName);
    if (!asset) {
      res.status(404).json({ detail: 'Audio file not found.' });
      return;
    }

    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Content-Length', asset.buffer.length);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(asset.buffer);
  });

  // Catch any unmatched /api/* route so it never falls through to SPA HTML
  router.use((_req, res) => {
    res.status(404).json({ detail: 'API endpoint not found.' });
  });

  // Always serialize API errors as JSON, never Express default HTML error pages
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      const msg =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Uploaded file exceeds the 15 MB limit. Please upload a smaller file.'
          : `Upload error: ${err.message}`;
      res.status(400).json({ detail: msg });
      return;
    }

    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ detail: 'Invalid JSON request payload.' });
      return;
    }

    const clean = toCleanHttpError(err);
    if (clean.statusCode >= 500) {
      console.error('[api] Error:', err);
    }
    res.status(clean.statusCode).json({ detail: clean.message });
  });

  return router;
}

async function bootstrap() {
  const app = express();

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use('/api', createApiRouter());

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.use((_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT} (prod=${IS_PROD})`);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
