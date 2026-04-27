@echo off
setlocal

title ISTUDIO Installer
set "ISTUDIO_REPO=YOUR_GITHUB_USERNAME/ISTUDIO"

echo.
echo ========================================
echo   ISTUDIO Installer
echo ========================================
echo.

if exist "%~dp0Install-ISTUDIO.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-ISTUDIO.ps1" -Repo "%ISTUDIO_REPO%"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $repo='%ISTUDIO_REPO%'; if ($repo -eq 'YOUR_GITHUB_USERNAME/ISTUDIO') { throw 'Installer repo is not configured yet.' }; $tmp=Join-Path $env:TEMP ('Install-ISTUDIO-' + [guid]::NewGuid() + '.ps1'); $url='https://raw.githubusercontent.com/' + $repo + '/main/installers/Install-ISTUDIO.ps1'; Invoke-WebRequest -Uri $url -OutFile $tmp -Headers @{ 'User-Agent'='ISTUDIO-Installer' }; & powershell -NoProfile -ExecutionPolicy Bypass -File $tmp -Repo $repo"
)

if errorlevel 1 (
  echo.
  echo ISTUDIO installation failed.
  pause
  exit /b 1
)

echo.
echo ISTUDIO is installed.
pause
