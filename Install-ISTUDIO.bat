@echo off
setlocal

title ISTUDIO Installer

if exist "%~dp0installers\Install-ISTUDIO.bat" (
  call "%~dp0installers\Install-ISTUDIO.bat"
  exit /b %errorlevel%
)

set "ISTUDIO_REPO=metadreamx/ISTUDIO"

echo.
echo ========================================
echo   ISTUDIO Installer
echo ========================================
echo.
echo Downloading the latest ISTUDIO installer...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $repo='%ISTUDIO_REPO%'; $tmp=Join-Path $env:TEMP ('Install-ISTUDIO-' + [guid]::NewGuid() + '.ps1'); $url='https://raw.githubusercontent.com/' + $repo + '/main/installers/Install-ISTUDIO.ps1'; Invoke-WebRequest -Uri $url -OutFile $tmp -Headers @{ 'User-Agent'='ISTUDIO-Installer' }; & powershell -NoProfile -ExecutionPolicy Bypass -File $tmp -Repo $repo"

if errorlevel 1 (
  echo.
  echo ISTUDIO installation failed.
  pause
  exit /b 1
)

echo.
echo ISTUDIO is installed.
pause
