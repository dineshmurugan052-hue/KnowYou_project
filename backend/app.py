import os
import re
import time
import uuid
import shutil
import tempfile
import traceback
from contextlib import asynccontextmanager
from typing import Dict, Any, Optional, Callable, TypeVar

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from google.genai import errors as genai_errors
from pydantic import BaseModel

from notebook_core import (
    create_gemini_client,
    get_resume,
    analyze_resume,
    start_interview,
    next_step,
    exit_interview,
    model_name,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        create_gemini_client()
    except Exception:
        pass
    yield


app = FastAPI(title="AI Resume Analyzer & Mock Interviewer Bridge", lifespan=lifespan)

T = TypeVar("T")


def _extract_status_code(exc: Exception) -> int:
    code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    if isinstance(code, int) and 400 <= code < 600:
        return code
    msg = str(exc)
    if "503" in msg or "UNAVAILABLE" in msg:
        return 503
    if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
        return 429
    if "403" in msg or "PERMISSION_DENIED" in msg:
        return 403
    if "400" in msg or "INVALID_ARGUMENT" in msg or "API_KEY_INVALID" in msg:
        return 400
    if "404" in msg or "NOT_FOUND" in msg:
        return 404
    return 500


def _is_transient_gemini_error(exc: Exception) -> bool:
    code = _extract_status_code(exc)
    if code in (500, 502, 503, 504):
        return True
    msg = str(exc).upper()
    return "UNAVAILABLE" in msg or "HIGH DEMAND" in msg or "OVERLOADED" in msg


def run_with_retry(fn: Callable[[], T], can_retry: Optional[Callable[[], bool]] = None) -> T:
    delays = [1.5, 3.0]
    last_exc: Optional[Exception] = None
    for attempt in range(len(delays) + 1):
        try:
            return fn()
        except Exception as exc:
            last_exc = exc
            should_retry = (
                attempt < len(delays)
                and _is_transient_gemini_error(exc)
                and (can_retry is None or can_retry())
            )
            if not should_retry:
                raise
            time.sleep(delays[attempt])
    assert last_exc is not None
    raise last_exc


def raise_clean_http_error(exc: Exception) -> None:
    status = _extract_status_code(exc)
    if status == 503:
        raise HTTPException(
            status_code=503,
            detail=f"The {model_name} model is temporarily experiencing high demand (503 UNAVAILABLE). Please wait a moment and try again.",
        )
    if status == 429:
        msg = str(exc)
        retry_match = re.search(r"retry in ([^.'\"]+)", msg, re.IGNORECASE)
        retry_hint = f" Retry window: {retry_match.group(1)}." if retry_match else ""
        raise HTTPException(
            status_code=429,
            detail=(
                f"API quota exceeded for {model_name}. "
                "To continue immediately, select a billing-enabled Gemini API key in Settings > Secrets, "
                f"or wait for the quota reset.{retry_hint}"
            ),
        )
    if isinstance(exc, genai_errors.APIError):
        raise HTTPException(status_code=status, detail=str(exc))
    traceback.print_exc()
    raise HTTPException(status_code=status, detail=str(exc))

BASE_TMP_DIR = os.path.join(tempfile.gettempdir(), "ai_resume_interviewer_sessions")
os.makedirs(BASE_TMP_DIR, exist_ok=True)

SESSIONS: Dict[str, Dict[str, Any]] = {}
MAX_SESSIONS = 100


def _store_session(session_id: str, data: Dict[str, Any]) -> None:
    while len(SESSIONS) >= MAX_SESSIONS:
        oldest_id = next(iter(SESSIONS))
        oldest = SESSIONS.pop(oldest_id, None)
        if oldest and oldest.get("session_dir"):
            shutil.rmtree(oldest["session_dir"], ignore_errors=True)
    SESSIONS[session_id] = data


class StartInterviewRequest(BaseModel):
    sessionId: str
    maxQ: int = 10


class ExitInterviewRequest(BaseModel):
    sessionId: str


def parse_analysis_sections(report_text: str) -> Dict[str, Any]:
    """
    Non-destructive parser for UI presentation only.
    Always preserves the complete raw report_text from Cell 6 alongside parsed fields.
    """
    score_match = re.search(r"(\d{1,3})\s*(?:/|out of)\s*100", report_text, re.IGNORECASE)
    ats_score = int(score_match.group(1)) if score_match else None
    if ats_score is not None:
        ats_score = max(0, min(100, ats_score))

    sections = {
        "atsSection": "",
        "missingSkillsSection": "",
        "improvementSection": "",
    }

    lines = report_text.splitlines()
    current_key = None
    buckets = {"atsSection": [], "missingSkillsSection": [], "improvementSection": []}

    for line in lines:
        low = line.strip().lower()
        if re.match(r"^(?:#{1,4}\s*)?(?:\*{0,2})?1[\.\):]?\s*ats\s*score", low) or (
            "ats score" in low and len(low) < 60
        ):
            current_key = "atsSection"
        elif re.match(r"^(?:#{1,4}\s*)?(?:\*{0,2})?2[\.\):]?\s*missing\s*skill", low) or (
            "missing skill" in low and len(low) < 60
        ):
            current_key = "missingSkillsSection"
        elif re.match(r"^(?:#{1,4}\s*)?(?:\*{0,2})?3[\.\):]?\s*improvement", low) or (
            "improvement in topics" in low and len(low) < 60
        ):
            current_key = "improvementSection"

        if current_key:
            buckets[current_key].append(line)

    for k, v in buckets.items():
        sections[k] = "\n".join(v).strip()

    return {
        "atsScore": ats_score,
        "atsSection": sections["atsSection"],
        "missingSkillsSection": sections["missingSkillsSection"],
        "improvementSection": sections["improvementSection"],
    }


@app.get("/api/health")
def health():
    return {"ok": True, "model": model_name}


@app.post("/api/analyze")
async def api_analyze(
    file: UploadFile = File(...),
    role: str = Form(...),
):
    clean_role = role.strip()
    if not clean_role:
        raise HTTPException(status_code=400, detail="Please enter a valid target job role.")

    filename = file.filename or "resume.txt"
    ext = os.path.splitext(filename)[1].lower()
    if ext not in [".txt", ".pdf", ".docx", ".png", ".jpg", ".jpeg", ".webp"]:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file format. Upload PDF, DOCX, TXT, PNG, JPG, JPEG, or WEBP.",
        )

    session_id = str(uuid.uuid4())
    session_dir = os.path.join(BASE_TMP_DIR, session_id)
    audio_dir = os.path.join(session_dir, "audio")
    os.makedirs(audio_dir, exist_ok=True)

    resume_path = os.path.join(session_dir, f"resume{ext}")
    content = await file.read()
    with open(resume_path, "wb") as f:
        f.write(content)

    try:
        resume_data = await run_in_threadpool(get_resume, resume_path)
        if isinstance(resume_data, str) and not resume_data.strip():
            raise HTTPException(
                status_code=400,
                detail="Could not extract readable text from the uploaded resume.",
            )

        client = create_gemini_client()
        report = await run_in_threadpool(
            run_with_retry,
            lambda: analyze_resume(client, resume_data, clean_role),
        )
    except HTTPException:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise_clean_http_error(exc)

    safe_report = report or ""

    _store_session(
        session_id,
        {
            "session_id": session_id,
            "filename": filename,
            "role": clean_role,
            "resume_data": resume_data,
            "report": safe_report,
            "session_dir": session_dir,
            "audio_dir": audio_dir,
            "chat": None,
            "session": None,
            "max_q": 10,
        },
    )

    return {
        "sessionId": session_id,
        "filename": filename,
        "role": clean_role,
        "report": safe_report,
        "parsed": parse_analysis_sections(safe_report),
    }


@app.post("/api/interview/start")
async def api_interview_start(req: StartInterviewRequest):
    state = SESSIONS.get(req.sessionId)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found. Please upload your resume first.")

    if req.maxQ < 1 or req.maxQ > 25:
        raise HTTPException(status_code=400, detail="Number of questions (max_q) must be between 1 and 25.")

    try:
        client = create_gemini_client()
        started = await run_in_threadpool(
            run_with_retry,
            lambda: start_interview(
                client,
                state["resume_data"],
                state["role"],
                state["audio_dir"],
                req.maxQ,
            ),
        )
    except Exception as exc:
        raise_clean_http_error(exc)

    state["client"] = client
    state["max_q"] = started["max_q"]
    state["chat"] = started["chat"]
    state["session"] = started["session"]

    q1_audio_url = (
        f"/api/audio/{req.sessionId}/{os.path.basename(started['q1_mp3'])}"
        if started.get("q1_mp3")
        else None
    )

    return {
        "sessionId": req.sessionId,
        "role": state["role"],
        "step": state["session"]["step"],
        "maxQ": state["max_q"],
        "question": started["q1"],
        "qView": f"Q1/{state['max_q']}: {started['q1']}",
        "audioUrl": q1_audio_url,
        "log": state["session"]["log"],
    }


@app.post("/api/interview/exit")
async def api_interview_exit(req: ExitInterviewRequest):
    state = SESSIONS.get(req.sessionId)
    if not state or not state.get("session"):
        raise HTTPException(status_code=404, detail="Interview session not started.")

    try:
        summary = await run_in_threadpool(
            exit_interview,
            state["session"],
            state["max_q"],
            state["audio_dir"],
        )
    except Exception as exc:
        raise_clean_http_error(exc)

    audio_url = (
        f"/api/audio/{req.sessionId}/{os.path.basename(summary['end_mp3'])}"
        if summary.get("end_mp3")
        else None
    )

    return {
        "sessionId": req.sessionId,
        "completed": True,
        "exitedEarly": True,
        "noAnswer": False,
        "step": state["session"]["step"],
        "maxQ": state["max_q"],
        "qView": "Interview Ended",
        "audioUrl": audio_url,
        "report": summary["report"],
        "latestTurn": state["session"]["log"][-1] if state["session"]["log"] else None,
        "scored": summary["scored"],
        "total": summary["total"],
        "percentage": summary["pct"],
        "log": state["session"]["log"],
    }


@app.post("/api/interview/answer")
async def api_interview_answer(
    sessionId: str = Form(...),
    boxText: Optional[str] = Form(""),
    micFile: Optional[UploadFile] = File(None),
):
    state = SESSIONS.get(sessionId)
    if not state or not state.get("session") or not state.get("chat"):
        raise HTTPException(status_code=404, detail="Interview session not started.")

    if state["session"]["step"] > state["max_q"]:
        scored = sum(item["mark"] for item in state["session"]["log"])
        total = state["max_q"] * 10
        pct = round((scored / total) * 100, 2) if total > 0 else 0.0
        final_mp3 = os.path.join(state["audio_dir"], "final.mp3")
        return {
            "sessionId": sessionId,
            "completed": True,
            "noAnswer": False,
            "step": state["session"]["step"],
            "maxQ": state["max_q"],
            "qView": "Interview Completed",
            "audioUrl": f"/api/audio/{sessionId}/final.mp3" if os.path.exists(final_mp3) else None,
            "report": "",
            "latestTurn": state["session"]["log"][-1] if state["session"]["log"] else None,
            "scored": scored,
            "total": total,
            "percentage": pct,
            "log": state["session"]["log"],
        }

    mic_path = None
    if micFile is not None:
        mic_bytes = await micFile.read()
        if mic_bytes:
            mic_path = os.path.join(
                state["session_dir"],
                f"mic_step_{state['session']['step']}_{uuid.uuid4().hex[:6]}.wav",
            )
            with open(mic_path, "wb") as f:
                f.write(mic_bytes)

    prev_log_len = len(state["session"]["log"])

    try:
        q_view, mp3_path, info_or_report, _, _ = await run_in_threadpool(
            run_with_retry,
            lambda: next_step(
                state["session"],
                state["max_q"],
                state["role"],
                state["chat"],
                state["audio_dir"],
                mic_path,
                boxText or "",
            ),
            lambda: len(state["session"]["log"]) == prev_log_len,
        )
    except Exception as exc:
        raise_clean_http_error(exc)
    finally:
        if mic_path and os.path.exists(mic_path):
            try:
                os.remove(mic_path)
            except OSError:
                pass

    completed = state["session"]["step"] > state["max_q"]
    no_answer = (len(state["session"]["log"]) == prev_log_len) and not completed
    latest_turn = state["session"]["log"][-1] if state["session"]["log"] else None

    audio_url = (
        f"/api/audio/{sessionId}/{os.path.basename(mp3_path)}"
        if mp3_path
        else None
    )

    if completed:
        scored = sum(item["mark"] for item in state["session"]["log"])
        total = state["max_q"] * 10
        pct = round((scored / total) * 100, 2)
        return {
            "sessionId": sessionId,
            "completed": True,
            "noAnswer": False,
            "step": state["session"]["step"],
            "maxQ": state["max_q"],
            "qView": q_view,
            "audioUrl": audio_url,
            "report": info_or_report,
            "latestTurn": latest_turn,
            "scored": scored,
            "total": total,
            "percentage": pct,
            "log": state["session"]["log"],
        }

    return {
        "sessionId": sessionId,
        "completed": False,
        "noAnswer": no_answer,
        "step": state["session"]["step"],
        "maxQ": state["max_q"],
        "question": state["session"]["q"],
        "qView": q_view,
        "audioUrl": audio_url,
        "info": info_or_report,
        "latestTurn": latest_turn if not no_answer else None,
        "log": state["session"]["log"],
    }


@app.get("/api/audio/{session_id}/{filename}")
def api_audio(session_id: str, filename: str):
    state = SESSIONS.get(session_id)
    if not state:
        raise HTTPException(status_code=404, detail="Session not found.")

    safe_name = os.path.basename(filename)
    file_path = os.path.join(state["audio_dir"], safe_name)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Audio file not found.")

    return FileResponse(file_path, media_type="audio/mpeg", filename=safe_name)
