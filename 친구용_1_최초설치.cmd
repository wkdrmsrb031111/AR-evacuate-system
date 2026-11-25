@echo off
chcp 65001 >nul
cd /d "%~dp0"
title AR 대피 앱 최초 설치

echo ========================================
echo AR 대피 앱 최초 설치를 시작합니다.
echo 이 작업은 처음 한 번만 실행하면 됩니다.
echo ========================================
echo.

where python >nul 2>&1
if errorlevel 1 (
  echo [오류] Python이 설치되어 있지 않습니다.
  echo Python 3.12를 설치한 뒤 다시 실행해 주세요.
  pause
  exit /b 1
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo [오류] Node.js가 설치되어 있지 않습니다.
  echo Node.js를 설치한 뒤 다시 실행해 주세요.
  pause
  exit /b 1
)

if not exist "server\.venv\Scripts\python.exe" (
  echo [1/3] Python 실행 환경을 만들고 있습니다...
  python -m venv server\.venv
  if errorlevel 1 goto :failed
) else (
  echo [1/3] 기존 Python 실행 환경을 사용합니다.
)

echo [2/3] 서버에 필요한 파일을 설치하고 있습니다...
"server\.venv\Scripts\python.exe" -m pip install -r server\requirements-dev.txt
if errorlevel 1 goto :failed

echo [3/3] 웹에 필요한 파일을 설치하고 있습니다...
pushd admin-web
call npm.cmd ci
if errorlevel 1 (
  popd
  goto :failed
)
popd

echo.
echo ========================================
echo 설치가 완료됐습니다.
echo 이제 '친구용_2_앱실행.cmd'를 더블클릭하세요.
echo ========================================
pause
exit /b 0

:failed
echo.
echo [오류] 설치 중 문제가 발생했습니다.
echo 위에 표시된 오류 화면을 캡처해서 팀원에게 보내 주세요.
pause
exit /b 1
