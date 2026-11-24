@echo off
cd /d "%~dp0"
if not exist "server\.venv\Scripts\python.exe" (
  echo Please follow server\README.md to install the server first.
  pause
  exit /b 1
)
"server\.venv\Scripts\python.exe" -m uvicorn server.main:app --host 127.0.0.1 --port 8000
pause
