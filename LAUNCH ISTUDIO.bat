@echo off
setlocal

title LAUNCH ISTUDIO
set "LAUNCHER_DIR=%~dp0"
set "INSTALL_DIR=%LAUNCHER_DIR%ISTUDIO"
set "ISTUDIO_REPO=metadreamx/ISTUDIO"
set "LAUNCH_MODE=-AutoLaunch"
set "INSTALL_MODE=-LaunchInline"

if /I "%~1"=="menu" set "LAUNCH_MODE=" & set "INSTALL_MODE=-MenuInline"
if /I "%~1"=="/menu" set "LAUNCH_MODE=" & set "INSTALL_MODE=-MenuInline"
if /I "%~1"=="--menu" set "LAUNCH_MODE=" & set "INSTALL_MODE=-MenuInline"

echo.
echo ========================================
echo   LAUNCH ISTUDIO
echo ========================================
echo.

if exist "%LAUNCHER_DIR%scripts\ISTUDIO-Launcher.ps1" (
  if exist "%LAUNCHER_DIR%runtime\node\node.exe" (
    if exist "%LAUNCHER_DIR%runtime\node\npm.cmd" (
      if exist "%LAUNCHER_DIR%node_modules" (
        if exist "%LAUNCHER_DIR%dist\index.html" (
          if exist "%LAUNCHER_DIR%dist-server\server.js" (
            set "INSTALL_DIR=%LAUNCHER_DIR%"
            goto launch_app
          )
        )
      )
    )
  )
)

if exist "%INSTALL_DIR%\scripts\ISTUDIO-Launcher.ps1" (
  if exist "%INSTALL_DIR%\runtime\node\node.exe" (
    if exist "%INSTALL_DIR%\runtime\node\npm.cmd" (
      if exist "%INSTALL_DIR%\node_modules" (
        if exist "%INSTALL_DIR%\dist\index.html" (
          if exist "%INSTALL_DIR%\dist-server\server.js" (
            goto launch_app
          )
        )
      )
    )
  )
)

echo ISTUDIO will be installed in this folder:
echo   "%INSTALL_DIR%"
echo.
echo To install somewhere else, close this window, move LAUNCH ISTUDIO.bat
echo to the folder where you want ISTUDIO, then run it again.
echo.
echo Installing or repairing ISTUDIO automatically...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $repo='%ISTUDIO_REPO%'; $installDir='%INSTALL_DIR%'; $tmp=Join-Path $env:TEMP ('Install-ISTUDIO-' + [guid]::NewGuid() + '.ps1'); $url='https://raw.githubusercontent.com/' + $repo + '/main/scripts/Install-ISTUDIO.ps1'; Invoke-WebRequest -Uri $url -OutFile $tmp -Headers @{ 'User-Agent'='ISTUDIO-Launcher' }; & powershell -NoProfile -ExecutionPolicy Bypass -File $tmp -Repo $repo -InstallDir $installDir %INSTALL_MODE%"
if errorlevel 1 (
  echo.
  echo ISTUDIO install or repair failed.
  echo Download the latest LAUNCH ISTUDIO.bat from GitHub Releases and run it again.
  pause
  exit /b 1
)
exit /b 0

:launch_app
cd /d "%INSTALL_DIR%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%INSTALL_DIR%\scripts\ISTUDIO-Launcher.ps1" %LAUNCH_MODE%
if errorlevel 1 (
  echo.
  echo ISTUDIO closed with an error.
  echo Download the latest LAUNCH ISTUDIO.bat from GitHub Releases and run it again.
  pause
  exit /b 1
)
