@echo off
setlocal
cd /d "%~dp0"
title DocuMitra AI Setup

echo.
echo ==============================================
echo       DocuMitra AI - Local Setup
 echo ==============================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo ERROR: Python was not found. Install Python 3.10+ from https://www.python.org/downloads/
  echo Enable "Add Python to PATH" during installation.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js/npm was not found. Install Node.js 18+ from https://nodejs.org/
  pause
  exit /b 1
)

if not exist "backend\.venv\Scripts\python.exe" (
  echo Creating Python virtual environment...
  python -m venv backend\.venv
  if errorlevel 1 (echo ERROR: Could not create Python environment.& pause & exit /b 1)
)
echo Installing/checking backend dependencies...
call backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
if errorlevel 1 (echo ERROR: Backend dependency installation failed.& pause & exit /b 1)

if not exist "frontend\node_modules" (
  echo Installing frontend dependencies. This may take a few minutes...
  pushd frontend
  call npm install
  if errorlevel 1 (popd & echo ERROR: Frontend dependency installation failed.& pause & exit /b 1)
  popd
)

if not exist "backend\.env" (
  copy "backend\.env.example" "backend\.env" >nul
  echo Created backend\.env. Add a Gemini key later if desired.
)
echo Starting backend at http://127.0.0.1:8000 ...
start "DocuMitra API" cmd /k "cd /d "%~dp0backend" && .venv\Scripts\python.exe -m uvicorn app:app --reload --port 8000"
timeout /t 3 /nobreak >nul
echo Starting frontend at http://127.0.0.1:5173 ...
start "DocuMitra Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev -- --host 127.0.0.1"
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:5173"
echo.
echo DocuMitra AI started. Keep both terminal windows open.
echo Gemini is optional; local summaries work without it.
echo.
pause
