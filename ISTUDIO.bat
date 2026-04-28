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

if not exist "%APP_DIR%runtime\node\node.exe" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo This folder does not include the bundled ISTUDIO runtime,
    echo and Node.js is not installed on this computer.
    echo.
    echo For normal users, run Install-ISTUDIO.bat instead.
    echo It installs ISTUDIO with all dependencies included.
    echo.
    if exist "%APP_DIR%Install-ISTUDIO.bat" (
      choice /c IE /n /m "Press I to install ISTUDIO, or E to exit: "
      if errorlevel 2 exit /b 0
      call "%APP_DIR%Install-ISTUDIO.bat"
      exit /b %errorlevel%
    )
    pause
    exit /b 1
  )
)

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
