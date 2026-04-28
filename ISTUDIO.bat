@echo off
setlocal

title ISTUDIO Launcher
set "APP_DIR=%~dp0"
set "ISTUDIO_REPO=metadreamx/ISTUDIO"
cd /d "%APP_DIR%"

echo.
echo ========================================
echo   ISTUDIO Launcher
echo ========================================
echo.

if not exist "%APP_DIR%scripts\ISTUDIO-Launcher.ps1" (
  goto install_from_release
)

if not exist "%APP_DIR%runtime\node\node.exe" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo This folder does not include the bundled ISTUDIO runtime,
    echo and Node.js is not installed on this computer.
    echo.
    echo Installing the complete ISTUDIO package now.
    echo.
    goto install_from_release
  )
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\ISTUDIO-Launcher.ps1"
if errorlevel 1 (
  echo.
  echo ISTUDIO Launcher closed with an error.
  echo.
  pause
  exit /b 1
)
exit /b 0

:install_from_release
echo This launcher will install or repair ISTUDIO automatically.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $repo='%ISTUDIO_REPO%'; $local=Join-Path '%APP_DIR%' 'installers\Install-ISTUDIO.ps1'; if (Test-Path $local) { & powershell -NoProfile -ExecutionPolicy Bypass -File $local -Repo $repo } else { $tmp=Join-Path $env:TEMP ('Install-ISTUDIO-' + [guid]::NewGuid() + '.ps1'); $url='https://raw.githubusercontent.com/' + $repo + '/main/installers/Install-ISTUDIO.ps1'; Invoke-WebRequest -Uri $url -OutFile $tmp -Headers @{ 'User-Agent'='ISTUDIO-Launcher' }; & powershell -NoProfile -ExecutionPolicy Bypass -File $tmp -Repo $repo }"
if errorlevel 1 (
  echo.
  echo ISTUDIO install or repair failed.
  pause
  exit /b 1
)

echo.
echo ISTUDIO is installed.
pause
