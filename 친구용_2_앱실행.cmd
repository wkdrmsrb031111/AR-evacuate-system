@echo off
chcp 65001 >nul
cd /d "%~dp0"
title AR 대피 앱 실행

if not exist "server\.venv\Scripts\python.exe" (
  echo 먼저 '친구용_1_최초설치.cmd'를 실행해 주세요.
  pause
  exit /b 1
)

if not exist "admin-web\node_modules" (
  echo 웹 설치 파일이 없습니다.
  echo 먼저 '친구용_1_최초설치.cmd'를 실행해 주세요.
  pause
  exit /b 1
)

echo 서버 창과 웹 창을 엽니다.
echo 두 창을 닫으면 앱도 종료됩니다.
start "AR Evacuate Server" "%~dp0로컬서버_실행.cmd"
timeout /t 3 /nobreak >nul
start "AR Evacuate Web" "%~dp0관리자웹_실행.cmd"
timeout /t 5 /nobreak >nul

echo 카메라 앱을 브라우저에서 엽니다.
start "" "http://127.0.0.1:5173/camera.html"
echo.
echo 장소가 비어 있다면 '친구용_3_예제데이터등록.cmd'를 실행하세요.
timeout /t 3 /nobreak >nul
exit /b 0
