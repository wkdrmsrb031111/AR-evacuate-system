@echo off
chcp 65001 >nul
cd /d "%~dp0"
title AR 대피 앱 예제 데이터

if not exist "server\.venv\Scripts\python.exe" (
  echo 먼저 '친구용_1_최초설치.cmd'를 실행해 주세요.
  pause
  exit /b 1
)

powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8000/api/status' -TimeoutSec 3 ^| Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  echo 서버가 실행 중이 아닙니다.
  echo 먼저 '친구용_2_앱실행.cmd'를 실행한 뒤 다시 시도해 주세요.
  pause
  exit /b 1
)

echo 가상 회사 예제 장소와 대피 경로를 등록합니다...
"server\.venv\Scripts\python.exe" scripts\seed_demo_photos.py
if errorlevel 1 (
  echo 예제 등록에 실패했습니다. 오류 화면을 캡처해 주세요.
  pause
  exit /b 1
)

echo.
echo 예제 등록이 완료됐습니다.
echo 앱 화면을 새로고침하고 '등록된 장소 불러오기'를 누르세요.
start "" "http://127.0.0.1:5173/camera.html"
pause
