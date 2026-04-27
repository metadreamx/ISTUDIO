@echo off
setlocal

title ISTUDIO Launcher
set "APP_DIR=%~dp0"
cd /d "%APP_DIR%"

if exist "%APP_DIR%runtime\node\node.exe" (
  set "PATH=%APP_DIR%runtime\node;%APP_DIR%runtime\node\node_modules\npm\bin;%PATH%"
)

echo.
echo ========================================
echo   ISTUDIO
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found on this computer.
  echo Install Node.js 22 or newer, then run this launcher again.
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found on this computer.
  echo Install Node.js 22 or newer, then run this launcher again.
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing ISTUDIO dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo Dependency installation failed.
    pause
    exit /b 1
  )
  echo.
)

if not exist "dist\index.html" (
  echo Building ISTUDIO for production...
  call npm run build
  if errorlevel 1 (
    echo.
    echo Production build failed.
    pause
    exit /b 1
  )
  echo.
)

set NODE_ENV=production
set PORT=4217
if not defined ISTUDIO_PROJECTS_DIR set "ISTUDIO_PROJECTS_DIR=%APP_DIR%projects"
if not exist "%ISTUDIO_PROJECTS_DIR%" mkdir "%ISTUDIO_PROJECTS_DIR%" >nul 2>nul
set ISTUDIO_URL=http://localhost:%PORT%

echo Starting ISTUDIO at %ISTUDIO_URL%
echo.
echo Keep this window open while using ISTUDIO.
echo Close it to stop the app.
echo.

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process '%ISTUDIO_URL%'"
call npm run start

pause
