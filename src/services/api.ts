import type {
  AnalyzeResponse,
  AnswerInterviewResponse,
  StartInterviewResponse,
} from '../types/interview';

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const contentType = res.headers.get('content-type') || '';
  const rawText = await res.text();
  const trimmed = rawText.trim();
  const looksLikeHtml =
    contentType.includes('text/html') ||
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html');

  if (!res.ok) {
    if (!looksLikeHtml && trimmed) {
      try {
        const data = JSON.parse(trimmed) as { detail?: unknown; error?: unknown; message?: unknown };
        if (typeof data?.detail === 'string' && data.detail) {
          throw new Error(data.detail);
        }
        if (typeof data?.error === 'string' && data.error) {
          throw new Error(data.error);
        }
        if (typeof data?.message === 'string' && data.message) {
          throw new Error(data.message);
        }
      } catch (err) {
        if (err instanceof Error && !(err instanceof SyntaxError)) {
          throw err;
        }
      }
    }
    throw new Error(
      looksLikeHtml
        ? `Server returned an unexpected HTML response (${res.status} ${res.statusText}). Please try again.`
        : `Request failed (${res.status} ${res.statusText || 'Error'}).`
    );
  }

  if (looksLikeHtml) {
    throw new Error(
      'Received an unexpected HTML page instead of JSON from the API server. Please refresh and try again.'
    );
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error('The server returned a malformed JSON response. Please try again.');
  }
}

export async function analyzeResume(file: File, role: string): Promise<AnalyzeResponse> {
  const form = new FormData();
  form.append('file', file);
  form.append('role', role);

  const res = await fetch('/api/analyze', {
    method: 'POST',
    body: form,
  });

  return parseJsonResponse<AnalyzeResponse>(res);
}

export async function startInterview(
  sessionId: string,
  maxQ: number,
  audioMode = true
): Promise<StartInterviewResponse> {
  const res = await fetch('/api/interview/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, maxQ, audioMode }),
  });

  return parseJsonResponse<StartInterviewResponse>(res);
}

export async function exitInterview(
  sessionId: string,
  audioMode = true
): Promise<AnswerInterviewResponse> {
  const res = await fetch('/api/interview/exit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, audioMode }),
  });

  return parseJsonResponse<AnswerInterviewResponse>(res);
}

export async function submitInterviewAnswer(
  sessionId: string,
  boxText: string,
  micWav: Blob | null,
  audioMode = true
): Promise<AnswerInterviewResponse> {
  const form = new FormData();
  form.append('sessionId', sessionId);
  form.append('boxText', boxText);
  form.append('audioMode', audioMode ? 'true' : 'false');
  if (micWav) {
    form.append('micFile', micWav, 'answer.wav');
  }

  const res = await fetch('/api/interview/answer', {
    method: 'POST',
    body: form,
  });

  return parseJsonResponse<AnswerInterviewResponse>(res);
}

export async function speakQuestionAudio(
  sessionId: string,
  text: string
): Promise<{ audioUrl: string | null }> {
  const res = await fetch('/api/interview/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, text }),
  });

  return parseJsonResponse<{ audioUrl: string | null }>(res);
}
