import os
import re
import json
import speech_recognition as sr
from PIL import Image
from pypdf import PdfReader
from docx import Document
from gtts import gTTS
from google import genai
from google.genai import types

model_name = "gemini-3.1-flash-lite"
_gemini_client = None


def create_gemini_client():
    global _gemini_client
    if _gemini_client is None:
        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("Gemini_API_Key_2")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY is not configured in the server environment.")
        _gemini_client = genai.Client(api_key=api_key)
    return _gemini_client


# --- Cell 3: Voice Conversion Functions ---
def make_audio(msg, out_file):
    plain = msg.replace("*", "").replace("#", "").strip()
    gTTS(text=plain, lang="en", tld="co.in").save(out_file)
    return out_file


def safe_make_audio(msg, out_file):
    try:
        return make_audio(msg, out_file)
    except Exception:
        return None


def read_voice(wav_file):
    if not wav_file:
        return ""
    rec = sr.Recognizer()
    try:
        with sr.AudioFile(wav_file) as src:
            return rec.recognize_google(rec.record(src))
    except (sr.UnknownValueError, ValueError, EOFError):
        return ""
    except sr.RequestError as exc:
        raise RuntimeError(
            f"Speech recognition service unavailable ({exc}). Please type your answer below."
        ) from exc


# --- Cell 4: Read Resume File Function ---
def get_resume(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".txt":
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read().strip()
    elif ext == ".pdf":
        pdf = PdfReader(path)
        return "\n".join(p.extract_text() or "" for p in pdf.pages).strip()
    elif ext == ".docx":
        doc = Document(path)
        lines = [p.text for p in doc.paragraphs if p.text.strip()]
        cells = [
            c.text.strip()
            for t in doc.tables
            for r in t.rows
            for c in r.cells
            if c.text.strip()
        ]
        return "\n".join(lines + cells).strip()
    elif ext in [".png", ".jpg", ".jpeg", ".webp"]:
        with Image.open(path) as pic:
            img = pic.copy()
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            if max(img.size) > 1600:
                img.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
            return img
    raise ValueError("Unsupported file format")


def _parse_eval_json(raw_text: str):
    text = (raw_text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise
        data = json.loads(match.group(0))

    if isinstance(data, list) and data and isinstance(data[0], dict):
        data = data[0]
    if not isinstance(data, dict):
        return {}
    return data


def _normalize_mark(raw_mark) -> int:
    try:
        val = int(round(float(raw_mark)))
    except (TypeError, ValueError):
        val = 0
    return max(0, min(10, val))


# --- Cell 6: Resume Analysis (ATS Score, Missing Skills, Improvement Topics) ---
def analyze_resume(client, resume_data, role):
    prompt = f"""
    You are a technical recruiter and ATS resume reviewer.
    Check the attached resume for the role: {role}.

    Give a clear report with these 3 sections:
    1. ATS Score: Score out of 100 with a short reason.
    2. Missing Skill Set: Important skills, tools, or frameworks for {role} that are missing or weak.
    3. Improvement in Topics: Specific technical topics, project updates, and resume sections to improve.
    """

    res = client.models.generate_content(
        model=model_name,
        contents=[prompt, resume_data],
        config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.MINIMAL),
        ),
    )
    return res.text or ""


# --- Cell 7: Start Configurable-Question Interview and Get Question 1 ---
def start_interview(client, resume_data, role, audio_dir, max_q=10):
    max_q = int(max_q)
    chat = client.chats.create(
        model=model_name,
        config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW),
            system_instruction=(
                f"You are a technical interviewer taking an interview for {role}. "
                "Ask short, clear questions based only on the skills and projects in the resume. "
                "Keep questions plain for audio playback without markdown symbols or bullet points."
            ),
        ),
    )

    q1_reply = chat.send_message(
        [
            resume_data,
            f"Ask Question 1 of {max_q} for {role} from the resume skills. Give only the question.",
        ]
    )
    q1 = (q1_reply.text or "").strip() or (
        f"Tell me about your most relevant project or technical experience for the {role} role."
    )
    q1_mp3 = safe_make_audio(f"Question 1. {q1}", os.path.join(audio_dir, "q_1.mp3"))

    session = {"step": 1, "q": q1, "log": []}
    return {
        "max_q": max_q,
        "chat": chat,
        "session": session,
        "q1": q1,
        "q1_mp3": q1_mp3,
    }


# --- Cell 8: Check Answer and Load Next Question ---
def next_step(session, max_q, role, chat, audio_dir, mic_file, box_text):
    if session["step"] > max_q:
        return "Interview completed.", None, "See your final scorecard below.", None, ""

    ans = box_text.strip() if box_text and box_text.strip() else read_voice(mic_file)
    if not ans:
        return (
            f"Q{session['step']}/{max_q}: {session['q']}",
            None,
            "No answer detected. Please record your voice or type your answer.",
            None,
            "",
        )

    step = session["step"]
    last = step == max_q

    check_prompt = f"""
    Question {step}: "{session['q']}"
    Candidate Answer: "{ans}"

    Grade out of 10 for {role}. Return only valid JSON:
    {{
      "marks": <integer 0 to 10>,
      "analysis": "<1 to 2 short spoken sentences>",
      "next_question": "{'DONE' if last else f'Ask Question {step + 1} of {max_q} from the resume skills (plain text only).'}"
    }}
    """

    reply = chat.send_message(
        check_prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW),
        ),
    )
    out = _parse_eval_json(reply.text or "{}")
    mark = _normalize_mark(out.get("marks", 0))
    note = str(out.get("analysis", "")).strip() or "Answer recorded."

    session["log"].append(
        {
            "step": step,
            "q": session["q"],
            "ans": ans,
            "mark": mark,
            "note": note,
        }
    )

    if last:
        session["step"] += 1
        scored = sum(item["mark"] for item in session["log"])
        total = max_q * 10
        pct = round((scored / total) * 100, 2) if total > 0 else 0.0

        report = f"FINAL SCORECARD: {scored}/{total} ({pct}%)\n\n"
        for item in session["log"]:
            report += f"Q{item['step']}: {item['q']}\nAnswer: {item['ans']}\nScore: {item['mark']}/10 | {item['note']}\n\n"

        end_mp3 = safe_make_audio(
            f"You scored {mark} out of 10. Interview complete. Your total score is {scored} out of {total}.",
            os.path.join(audio_dir, "final.mp3"),
        )
        return "Interview Completed", end_mp3, report, None, ""

    nxt_q = str(out.get("next_question", "")).strip()
    if not nxt_q or nxt_q.upper() == "DONE":
        nxt_q = (
            f"Walk me through a key technical decision you made in a project relevant to {role}."
        )
    session["step"] += 1
    session["q"] = nxt_q

    nxt_mp3 = safe_make_audio(
        f"You scored {mark} out of 10. {note}. Question {session['step']}. {nxt_q}",
        os.path.join(audio_dir, f"q_{session['step']}.mp3"),
    )
    info = f"Your Answer: {ans}\nScore: {mark}/10 - {note}"
    return f"Q{session['step']}/{max_q}: {nxt_q}", nxt_mp3, info, None, ""


def exit_interview(session, max_q, audio_dir):
    session["step"] = max_q + 1
    answered = len(session["log"])
    scored = sum(item["mark"] for item in session["log"])
    total = answered * 10
    pct = round((scored / total) * 100, 2) if total > 0 else 0.0

    report = f"FINAL SCORECARD: {scored}/{total} ({pct}%)\n"
    report += f"Questions Answered: {answered} of {max_q}\n\n"
    if answered == 0:
        report += "No questions were answered before exiting the interview.\n"
    else:
        for item in session["log"]:
            report += f"Q{item['step']}: {item['q']}\nAnswer: {item['ans']}\nScore: {item['mark']}/10 | {item['note']}\n\n"

    spoken_summary = (
        "Interview ended before any questions were answered."
        if answered == 0
        else f"Interview ended. You answered {answered} out of {max_q} questions. Your score is {scored} out of {total}."
    )
    end_mp3 = safe_make_audio(spoken_summary, os.path.join(audio_dir, "final.mp3"))

    return {
        "scored": scored,
        "total": total,
        "pct": pct,
        "report": report,
        "end_mp3": end_mp3,
    }
