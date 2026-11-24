@echo off
cd /d "%~dp0"
if not exist "server\.venv\Scripts\python.exe" (
  echo Please follow server\README.md to install the server first.
  pause
  exit /b 1
)
echo App read-only server: http://127.0.0.1:8001/app-test
echo Local PC testing only. This does not enable phone access yet.
"server\.venv\Scripts\python.exe" -m uvicorn server.app_reader:app --host 127.0.0.1 --port 8001
pause
