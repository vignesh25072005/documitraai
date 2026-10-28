# DocuMitra AI — Complete Local Project

A local document-intelligence workspace built with React + Vite and FastAPI. Upload searchable PDF, DOCX, or TXT documents, ask document-grounded questions, and generate summaries.

**Important reliability note:** Gemini is optional. If no API key is configured, or if Google returns quota/rate-limit/service errors, uploads and a local extractive summarizer still work. Local results are labelled `LOCAL SUMMARY` rather than being presented as Gemini output. No software can bypass a provider's exhausted quota.

## Requirements

- Windows 10/11
- Python 3.10 or newer (3.11/3.12 recommended)
- Node.js 18 or newer (includes npm)
- Internet connection for the first dependency installation and optional Gemini requests

## Quick start (Windows)

1. Extract this ZIP to a normal folder (not inside the ZIP preview or a protected system folder).
2. Optional: open `backend/.env` and set your Gemini key as described below. The project also works without a key.
3. Double-click `run_windows.bat`.
4. Wait for two terminal windows to open, then use `http://127.0.0.1:5173`.
5. Keep both terminal windows open while using the app.

The first launch creates `backend/.venv`, installs Python packages, and runs `npm install` for the frontend. This may take a few minutes.

## Configure Gemini (optional)

1. Open `backend/.env` in VS Code or Notepad.
2. Set:

   ```env
   GEMINI_API_KEY=PASTE_YOUR_OWN_KEY_HERE
   GEMINI_MODEL=gemini-2.5-flash
   ```

3. Save the file and restart the backend terminal.

Do not share your key or commit the `.env` file. The project uses a text-generation model; it does not automatically switch to image-preview models. Google AI Studio quotas vary by account, project, model, and time. HTTP 429 means quota/rate limit; HTTP 503 means temporary provider unavailability. When Gemini is unavailable, local summaries remain available.

## Manual start

Open two terminals from the extracted project folder.

**Terminal 1 — backend**

```bat
cd backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m uvicorn app:app --reload --port 8000
```

**Terminal 2 — frontend**

```bat
cd frontend
npm install
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173`.

## Supported features

- Upload PDF, DOCX, TXT (20 MB maximum per file)
- Extract text from searchable PDFs, DOCX paragraphs/tables, and TXT
- Local SQLite document library, upload metadata, and delete documents
- Local document summary and retrieval-based answers without API quota
- Optional Gemini-generated answers/summaries, with graceful fallback and visible diagnostic notes
- Source snippets and page references where available

Scanned/image-only PDFs need OCR before upload; this version does not include OCR. Files are stored locally in `backend/data`.

## Troubleshooting

- **API offline:** check that the backend terminal is running and visit `http://127.0.0.1:8000/api/health`.
- **Gemini 401/403:** check the key and its API access.
- **Gemini 404:** check `GEMINI_MODEL` and whether that model is available to your project.
- **Gemini 429:** quota or rate limit reached. Wait for reset or check Google AI Studio's rate-limit page; changing code cannot bypass project quota.
- **Gemini 503:** temporary provider overload; retry later. The local summarizer should still work.
- **Upload says no selectable text:** the PDF may be scanned; OCR it or export a searchable PDF.
- **Port already in use:** stop the other app using port 8000 or 5173, then relaunch.

Health endpoint: `http://127.0.0.1:8000/api/health`
