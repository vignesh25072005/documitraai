"""DocuMitra AI local document assistant.

Gemini is optional. If the remote API is unavailable or quota-limited, document
upload, local summaries, and retrieval-based answers continue to work locally.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import time
import uuid
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import fitz
from docx import Document as DocxDocument
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env", override=False)
DATA_DIR = ROOT / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "documitra.sqlite3"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
LAST_AI_ERROR: Optional[str] = None

app = FastAPI(title="DocuMitra AI API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:4173", "http://127.0.0.1:4173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    document_ids: list[str] = Field(default_factory=list)
    mode: str = "ask"


def db():
    con = sqlite3.connect(DB_PATH, timeout=15)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    with db() as con:
        con.execute("""
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                file_type TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                text_content TEXT NOT NULL,
                pages INTEGER DEFAULT 0,
                uploaded_at TEXT NOT NULL
            )
        """)


init_db()


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def extract_file_text(path: Path, suffix: str):
    if suffix == ".pdf":
        with fitz.open(path) as pdf:
            pages = []
            for index, page in enumerate(pdf, start=1):
                content = page.get_text("text").strip()
                if content:
                    pages.append(f"[Page {index}]\n{content}")
            return "\n\n".join(pages), len(pdf)
    if suffix == ".docx":
        doc = DocxDocument(path)
        chunks = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
        for table in doc.tables:
            for row in table.rows:
                cells = [cell.text.strip() for cell in row.cells]
                if any(cells):
                    chunks.append(" | ".join(cells))
        return "\n".join(chunks), 1
    if suffix == ".txt":
        return path.read_text(encoding="utf-8", errors="replace"), 1
    raise HTTPException(status_code=415, detail="Unsupported file type. Upload PDF, DOCX, or TXT.")


def clean_snippet(text: str, limit: int = 240):
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0] + "…"


def get_documents(ids: Optional[list[str]] = None):
    with db() as con:
        if ids:
            # Bound parameter list; avoid an invalid IN () clause.
            marks = ",".join("?" for _ in ids)
            rows = con.execute(
                f"SELECT * FROM documents WHERE id IN ({marks}) ORDER BY uploaded_at DESC", ids
            ).fetchall()
        else:
            rows = con.execute("SELECT * FROM documents ORDER BY uploaded_at DESC").fetchall()
    return [dict(row) for row in rows]


def tokenize(text: str):
    return set(re.findall(r"[a-zA-Z0-9][a-zA-Z0-9_'-]{1,}", text.lower()))


def chunk_text(doc: dict, chunk_size: int = 2200, overlap: int = 250):
    text = doc.get("text_content", "")
    if not text.strip():
        return []
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks, current = [], ""
    for para in paragraphs:
        if len(para) > chunk_size:
            if current:
                chunks.append(current)
                current = ""
            step = max(1, chunk_size - overlap)
            chunks.extend(para[i:i + chunk_size] for i in range(0, len(para), step))
        elif len(current) + len(para) + 2 <= chunk_size:
            current = f"{current}\n\n{para}".strip()
        else:
            if current:
                chunks.append(current)
            current = para
    if current:
        chunks.append(current)
    return [{"text": c, "document_id": doc["id"], "filename": doc["filename"],
             "file_type": doc["file_type"]} for c in chunks]


def retrieve(question: str, docs: list[dict], limit: int = 6):
    q_tokens = tokenize(question)
    scored = []
    for doc in docs:
        for chunk in chunk_text(doc):
            c_tokens = tokenize(chunk["text"])
            if not c_tokens:
                continue
            overlap = len(q_tokens & c_tokens)
            # A mild IDF-like adjustment avoids rewarding generic words too much.
            score = overlap / max(1, len(q_tokens))
            if question.strip().lower() in chunk["text"].lower():
                score += 0.12
            if score > 0:
                chunk["score"] = score
                scored.append(chunk)
    scored.sort(key=lambda item: item["score"], reverse=True)
    if not scored:
        # General summary prompts often do not share exact words with the source.
        for doc in docs:
            for chunk in chunk_text(doc):
                chunk["score"] = 0.01
                scored.append(chunk)
    return scored[:limit]


STOP_WORDS = set("""a an the and or but if then than so to of in on for from by with at as is are was were be been being it its this that these those into about over under after before between through during we you your they their he she them his her our can could should would may might will not no yes do does did have has had use uses using used also such each other more most some any all very when where what which who why how""".split())


def split_sentences(text: str):
    text = re.sub(r"\[Page\s+\d+\]\s*", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    raw = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(`])|\n+", text)
    result = []
    for s in raw:
        s = re.sub(r"\s+", " ", s).strip(" \t\r\n•*-–")
        if len(s) >= 35 and len(tokenize(s)) >= 5:
            result.append(s)
    return result


def local_summary(text: str, filename: str, max_sentences: int = 9):
    """Produce a readable extractive summary without requiring an API key."""
    sentences = split_sentences(text)
    if not sentences:
        return ("I couldn't extract selectable text from this document. If it is a scanned PDF, "
                "run OCR on it and upload the searchable version.")
    # Score informative sentences using normalized term frequency and position.
    freq: dict[str, int] = {}
    tokenized = []
    for sentence in sentences:
        words = [w for w in tokenize(sentence) if w not in STOP_WORDS and not w.isdigit()]
        tokenized.append(words)
        for word in set(words):
            freq[word] = freq.get(word, 0) + 1
    scored = []
    total = max(1, len(sentences))
    for i, (sentence, words) in enumerate(zip(sentences, tokenized)):
        if not words:
            continue
        term_score = sum(1 + (freq[w] ** 0.5) for w in words) / (len(words) ** 0.65)
        length_penalty = 0.7 if len(sentence) > 420 else (0.8 if len(sentence) < 55 else 1.0)
        position_bonus = 1.15 if i < max(3, total * 0.12) else 1.0
        scored.append((term_score * length_penalty * position_bonus, i, sentence))
    selected = sorted(scored, reverse=True)[:max_sentences]
    selected = sorted(selected, key=lambda item: item[1])
    if not selected:
        return clean_snippet(text, 1600)
    overview = " ".join(s for _, _, s in selected[:3])
    key_points = selected[3:]
    lines = [f"## Summary: {filename}", "", "### Overview", overview, "", "### Key takeaways"]
    for _, _, sentence in key_points:
        lines.append(f"• {sentence}")
    if not key_points:
        for _, _, sentence in selected[:3]:
            lines.append(f"• {sentence}")
    lines += ["", "*Local summary generated from extracted document text. Gemini is optional; this result does not require API quota.*"]
    return "\n".join(lines)


def local_answer(question: str, chunks: list[dict], mode: str = "ask"):
    if mode == "summary":
        if chunks:
            return local_summary("\n\n".join(c["text"] for c in chunks), chunks[0]["filename"])
        return "No readable text was found to summarize."
    if not chunks:
        return "I couldn't find relevant text in the selected documents. Try a more specific question or check whether the PDF is scanned."
    question_tokens = tokenize(question) - STOP_WORDS
    candidates = []
    for chunk in chunks:
        for sentence in split_sentences(chunk["text"]):
            words = tokenize(sentence) - STOP_WORDS
            overlap = len(words & question_tokens)
            if overlap:
                candidates.append((overlap / max(1, len(question_tokens)), sentence, chunk["filename"]))
    candidates.sort(key=lambda x: x[0], reverse=True)
    unique = []
    seen = set()
    for _, sentence, filename in candidates:
        key = sentence.lower()
        if key not in seen:
            seen.add(key)
            unique.append((sentence, filename))
        if len(unique) >= 5:
            break
    if not unique:
        return "I couldn't find a direct answer in the retrieved text. Try asking about a specific concept, heading, or keyword.\n\n" + "\n".join(f"• {c['filename']}: {clean_snippet(c['text'], 300)}" for c in chunks[:3])
    return "## Relevant information from your documents\n\n" + "\n".join(f"• {sentence} *(Source: {filename})*" for sentence, filename in unique) + "\n\n*Local document-grounded answer. Gemini is optional.*"


def gemini_request(prompt: str):
    """Call one explicitly configured text model; never switch to image-preview models."""
    global LAST_AI_ERROR
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        LAST_AI_ERROR = "No GEMINI_API_KEY configured; using local mode."
        return None
    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()
    if not model.startswith("models/"):
        model = model.removeprefix("/")
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    body = json.dumps({
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 1800},
    }).encode("utf-8")
    request = urllib.request.Request(endpoint, data=body, headers={"Content-Type": "application/json"}, method="POST")
    for attempt in range(2):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                payload = json.loads(response.read().decode("utf-8"))
            candidates = payload.get("candidates", [])
            if not candidates:
                LAST_AI_ERROR = "Gemini returned no candidates; using local mode."
                return None
            parts = candidates[0].get("content", {}).get("parts", [])
            answer = "\n".join(p.get("text", "") for p in parts).strip()
            if answer:
                LAST_AI_ERROR = None
                return answer
            LAST_AI_ERROR = "Gemini returned an empty response; using local mode."
            return None
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            # Retry a single transient 503 once; never retry quota/permission errors.
            if exc.code == 503 and attempt == 0:
                time.sleep(1.2)
                continue
            try:
                parsed = json.loads(detail)
                message = parsed.get("error", {}).get("message", detail)
            except Exception:
                message = detail
            LAST_AI_ERROR = f"Gemini HTTP {exc.code}: {message[:700]}"
            print(LAST_AI_ERROR)
            return None
        except Exception as exc:
            LAST_AI_ERROR = f"Gemini request failed ({type(exc).__name__}): {exc}"
            print(LAST_AI_ERROR)
            return None
    return None


def make_prompt(question: str, chunks: list[dict], mode: str):
    context = "\n\n".join(
        f"SOURCE {i + 1} — {c['filename']}\n{c['text'][:5500]}"
        for i, c in enumerate(chunks[:8])
    )
    if mode == "summary":
        task = ("Create a useful, concise document summary. Use headings: Overview, Key concepts, "
                "Important details, Conclusion. Explain ideas in plain language. Do not dump raw passages or code imports. "
                "Only state what is supported by the source material.")
    else:
        task = ("Answer the question using only the supplied source material. Cite the source filename where useful. "
                "If the documents do not contain the answer, say so. Do not invent facts.")
    return f"You are DocuMitra AI, a careful document assistant.\n{task}\n\nSOURCE MATERIAL:\n{context}\n\nQUESTION:\n{question}"


def answer_for(question: str, docs: list[dict], mode: str, chunks: list[dict]):
    global LAST_AI_ERROR
    # For summaries, use the full selected document text rather than six keyword matches.
    if mode == "summary" and docs:
        source = docs[0]
        full_chunks = chunk_text(source, chunk_size=5000, overlap=250)
        # One call with a bounded selection across the whole document; local summary always sees full text.
        if len(full_chunks) > 8:
            stride = max(1, len(full_chunks) // 8)
            ai_chunks = full_chunks[::stride][:8]
        else:
            ai_chunks = full_chunks
        local = local_summary(source["text_content"], source["filename"])
        ai = gemini_request(make_prompt(question, ai_chunks, mode)) if os.getenv("GEMINI_API_KEY", "").strip() else None
        return (ai, local)
    ai = gemini_request(make_prompt(question, chunks, mode)) if os.getenv("GEMINI_API_KEY", "").strip() else None
    return (ai, local_answer(question, chunks, mode))


def source_payload(chunks: list[dict]):
    sources, seen = [], set()
    for chunk in chunks:
        key = (chunk.get("document_id"), clean_snippet(chunk["text"], 90))
        if key in seen:
            continue
        seen.add(key)
        page_match = re.search(r"\[Page\s+(\d+)\]", chunk["text"])
        sources.append({
            "document_id": chunk.get("document_id"), "filename": chunk["filename"],
            "reference": f"Page {page_match.group(1)}" if page_match else "Extracted text",
            "snippet": clean_snippet(chunk["text"], 260), "score": round(chunk.get("score", 0), 3),
        })
    return sources


@app.get("/api/health")
def health():
    key_configured = bool(os.getenv("GEMINI_API_KEY", "").strip())
    return {
        "status": "ok", "ai_enabled": key_configured,
        "mode": "gemini-configured" if key_configured else "local",
        "key_configured": key_configured,
        "last_ai_error": LAST_AI_ERROR,
        "local_fallback_available": True,
    }


@app.get("/api/documents")
def list_documents():
    return [{
        "id": d["id"], "filename": d["filename"], "file_type": d["file_type"],
        "size_bytes": d["size_bytes"], "pages": d["pages"], "uploaded_at": d["uploaded_at"],
        "characters": len(d["text_content"]), "preview": clean_snippet(d["text_content"], 150),
    } for d in get_documents()]


@app.post("/api/documents/upload")
async def upload_document(file: UploadFile = File(...)):
    filename = Path(file.filename or "upload.txt").name
    suffix = Path(filename).suffix.lower()
    if suffix not in {".pdf", ".docx", ".txt"}:
        raise HTTPException(status_code=415, detail="Supported formats: PDF, DOCX, TXT.")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Maximum file size is 20 MB.")
    doc_id = str(uuid.uuid4())
    stored_path = UPLOAD_DIR / f"{doc_id}{suffix}"
    stored_path.write_bytes(content)
    try:
        text, pages = extract_file_text(stored_path, suffix)
    except Exception as exc:
        stored_path.unlink(missing_ok=True)
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(status_code=400, detail=f"Could not read this file: {type(exc).__name__}.") from exc
    if not text.strip():
        stored_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail="No selectable text found. Scanned PDFs need OCR before upload.")
    with db() as con:
        con.execute(
            "INSERT INTO documents (id, filename, file_type, size_bytes, text_content, pages, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (doc_id, filename, suffix[1:].upper(), len(content), text, pages, utc_now()),
        )
    return {"id": doc_id, "filename": filename, "file_type": suffix[1:].upper(), "size_bytes": len(content),
            "pages": pages, "characters": len(text), "preview": clean_snippet(text, 150)}


@app.delete("/api/documents/{document_id}")
def delete_document(document_id: str):
    docs = get_documents([document_id])
    if not docs:
        raise HTTPException(status_code=404, detail="Document not found.")
    with db() as con:
        con.execute("DELETE FROM documents WHERE id = ?", (document_id,))
    for path in UPLOAD_DIR.glob(f"{document_id}.*"):
        path.unlink(missing_ok=True)
    return {"deleted": True}


@app.post("/api/chat")
def chat(req: ChatRequest):
    docs = get_documents(req.document_ids or None)
    if not docs:
        raise HTTPException(status_code=400, detail="Upload at least one document before asking a question.")
    mode = "summary" if req.mode == "summary" or "summar" in req.question.lower() and any(x in req.question.lower() for x in ["document", "main ideas", "key takeaways", "overview"]) else "ask"
    chunks = retrieve(req.question, docs, limit=8)
    ai, local = answer_for(req.question, docs if mode == "summary" else docs, mode, chunks)
    answer = ai or local
    mode_used = "gemini" if ai else "local"
    notice = None if ai else (LAST_AI_ERROR or "Gemini is not configured. Using local document mode.")
    return {"answer": answer, "sources": source_payload(chunks), "mode": mode_used, "notice": notice}


@app.post("/api/documents/{document_id}/summary")
def summarize_document(document_id: str):
    docs = get_documents([document_id])
    if not docs:
        raise HTTPException(status_code=404, detail="Document not found.")
    doc = docs[0]
    # Summary operates over the full document, not keyword-only retrieval snippets.
    chunks = chunk_text(doc, chunk_size=5000, overlap=250)
    ai, local = answer_for("Summarize this document and list its key takeaways.", docs, "summary", chunks)
    answer = ai or local
    return {
        "answer": answer, "mode": "gemini" if ai else "local",
        "notice": None if ai else (LAST_AI_ERROR or "Using local summarization; no Gemini request was made."),
        "sources": [{"filename": doc["filename"], "snippet": clean_snippet(c["text"], 260)} for c in chunks[:8]],
    }
