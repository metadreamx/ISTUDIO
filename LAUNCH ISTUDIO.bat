@echo off
setlocal

title LAUNCH ISTUDIO
set "CURRENT_DIR=%~dp0"
set "INSTALL_DIR=%LOCALAPPDATA%\ISTUDIO\"
set "ISTUDIO_REPO=metadreamx/ISTUDIO"
set "LAUNCH_MODE=-AutoLaunch"

if /I "%~1"=="menu" set "LAUNCH_MODE="
if /I "%~1"=="/menu" set "LAUNCH_MODE="
if /I "%~1"=="--menu" set "LAUNCH_MODE="

cd /d "%CURRENT_DIR%"

echo.
echo ========================================
echo   LAUNCH ISTUDIO
echo ========================================
echo.

set "APP_DIR=%CURRENT_DIR%"
if exist "%CURRENT_DIR%scripts\ISTUDIO-Launcher.ps1" (
  if exist "%CURRENT_DIR%runtime\node\node.exe" goto launch_app
  where node >nul 2>nul
  if not errorlevel 1 goto launch_app
)

if exist "%INSTALL_DIR%scripts\ISTUDIO-Launcher.ps1" (
  if exist "%INSTALL_DIR%runtime\node\node.exe" (
    set "APP_DIR=%INSTALL_DIR%"
    goto launch_app
  )
)

echo Installing or repairing ISTUDIO automatically...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $repo='%ISTUDIO_REPO%'; $installDir='%INSTALL_DIR%'; $local=Join-Path '%CURRENT_DIR%' 'scripts\Install-ISTUDIO.ps1'; if (Test-Path $local) { & powershell -NoProfile -ExecutionPolicy Bypass -File $local -Repo $repo -InstallDir $installDir -NoLaunch } else { $tmp=Join-Path $env:TEMP ('Install-ISTUDIO-' + [guid]::NewGuid() + '.ps1'); $url='https://raw.githubusercontent.com/' + $repo + '/main/scripts/Install-ISTUDIO.ps1'; Invoke-WebRequest -Uri $url -OutFile $tmp -Headers @{ 'User-Agent'='ISTUDIO-Launcher' }; & powershell -NoProfile -ExecutionPolicy Bypass -File $tmp -Repo $repo -InstallDir $installDir -NoLaunch }"
if errorlevel 1 (
  echo.
  echo ISTUDIO install or repair failed.
  pause
  exit /b 1
)

if exist "%INSTALL_DIR%scripts\ISTUDIO-Launcher.ps1" (
  set "APP_DIR=%INSTALL_DIR%"
  goto launch_app
)

echo.
echo ISTUDIO installed, but the launcher was not found in "%INSTALL_DIR%".
pause
exit /b 1

:launch_app
cd /d "%APP_DIR%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%scripts\ISTUDIO-Launcher.ps1" %LAUNCH_MODE%
if errorlevel 1 (
  echo.
  echo ISTUDIO closed with an error.
  echo If this keeps happening, run this file again to repair the installation.
  pause
  exit /b 1
)
