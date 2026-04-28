@echo off
setlocal

title LAUNCH ISTUDIO
set "APP_DIR=%~dp0"
set "ISTUDIO_REPO=metadreamx/ISTUDIO"
cd /d "%APP_DIR%"

echo.
echo ========================================
echo   LAUNCH ISTUDIO
echo ========================================
echo.

if exist "%APP_DIR%scripts\ISTUDIO-Launcher.ps1" (
  if exist "%APP_DIR%runtime\node\node.exe" goto launch_local
  where node >nul 2>nul
  if not errorlevel 1 goto launch_local
)

echo Installing or repairing ISTUDIO automatically...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $repo='%ISTUDIO_REPO%'; $local=Join-Path '%APP_DIR%' 'scripts\Install-ISTUDIO.ps1'; if (Test-Path $local) { & powershell -NoProfile -ExecutionPolicy Bypass -File $local -Repo $repo } else { $tmp=Join-Path $env:TEMP ('Install-ISTUDIO-' + [guid]::NewGuid() + '.ps1'); $url='https://raw.githubusercontent.com/' + $repo + '/main/scripts/Install-ISTUDIO.ps1'; Invoke-WebRequest -Uri $url -OutFile $tmp -Headers @{ 'User-Agent'='ISTUDIO-Launcher' }; & powershell -NoProfile -ExecutionPolicy Bypass -File $tmp -Repo $repo }"
if errorlevel 1 (
  echo.
  echo ISTUDIO install or repair failed.
  pause
  exit /b 1
)
exit /b 0

:launch_local
powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\ISTUDIO-Launcher.ps1"
if errorlevel 1 (
  echo.
  echo ISTUDIO closed with an error.
  echo If this keeps happening, run this file again to repair the installation.
  pause
  exit /b 1
)
