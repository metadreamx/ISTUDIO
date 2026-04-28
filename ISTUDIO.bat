@echo off
setlocal

title ISTUDIO Launcher
set "APP_DIR=%~dp0"
cd /d "%APP_DIR%"

echo.
echo ========================================
echo   ISTUDIO Launcher
echo ========================================
echo.

if not exist "%APP_DIR%scripts\ISTUDIO-Launcher.ps1" (
  echo Launcher file missing:
  echo %APP_DIR%scripts\ISTUDIO-Launcher.ps1
  echo.
  pause
  exit /b 1
)

set "ISTUDIO_REPO=metadreamx/ISTUDIO"
powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\ISTUDIO-Launcher.ps1"
if errorlevel 1 (
  echo.
  echo ISTUDIO Launcher closed with an error.
  echo.
  pause
  exit /b 1
)
