@echo off
setlocal

title ISTUDIO
set "ISTUDIO_SELF=%~f0"
set "ISTUDIO_MODE=%~1"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $self=$env:ISTUDIO_SELF; $mode=$env:ISTUDIO_MODE; $script=[System.Text.StringBuilder]::new(); $capture=$false; foreach($line in [System.IO.File]::ReadLines($self)){ if($line -eq '__ISTUDIO_PAYLOAD_B64__'){ break }; if($capture){ [void]$script.AppendLine($line) }; if($line -eq '__ISTUDIO_SETUP_PS1__'){ $capture=$true } }; $block=[scriptblock]::Create($script.ToString()); & $block -Self $self -Mode $mode; exit $LASTEXITCODE"
if errorlevel 1 (
  echo.
  echo ISTUDIO setup did not complete.
  pause
  exit /b 1
)
exit /b 0

__ISTUDIO_SETUP_PS1__
param(
  [string]$Self,
  [string]$Mode = ""
)

$ErrorActionPreference = "Stop"
$script:SetupHeaderTitle = "ISTUDIO Installer"

function Write-SetupHeader {
  param([string]$Subtitle)

  Clear-Host
  Write-Host ""
  Write-Host "========================================" -ForegroundColor DarkGray
  Write-Host "  $script:SetupHeaderTitle" -ForegroundColor White
  Write-Host "  Iconic Recordings" -ForegroundColor Gray
  Write-Host "========================================" -ForegroundColor DarkGray
  Write-Host ""
  if (-not [string]::IsNullOrWhiteSpace($Subtitle)) {
    Write-Host $Subtitle -ForegroundColor Cyan
    Write-Host ""
  }
}

function Write-Step {
  param(
    [int]$Number,
    [int]$Total,
    [string]$Message
  )

  Write-Host ("[{0}/{1}] {2}" -f $Number, $Total, $Message) -ForegroundColor Cyan
}

function Test-IStudioInstall {
  param([string]$Path)

  $required = @(
    "LAUNCH.bat",
    "package.json",
    "dist-server\server.js",
    "dist\index.html",
    "scripts\ISTUDIO-Launcher.ps1",
    "node_modules",
    "runtime\node\node.exe",
    "runtime\node\npm.cmd"
  )

  foreach ($item in $required) {
    if (-not (Test-Path (Join-Path $Path $item))) {
      return $false
    }
  }
  return $true
}

function Get-InstallDirectory {
  param([string]$InstallerPath)

  $launcherDir = Split-Path -Parent ([System.IO.Path]::GetFullPath($InstallerPath))
  if (Test-IStudioInstall -Path $launcherDir) {
    return $launcherDir
  }
  return Join-Path $launcherDir "ISTUDIO"
}

function New-LocalSetupTemp {
  param([string]$InstallerPath)

  $launcherDir = Split-Path -Parent ([System.IO.Path]::GetFullPath($InstallerPath))
  $setupRoot = Join-Path $launcherDir ".istudio-setup-temp"

  try {
    New-Item -ItemType Directory -Force -Path $setupRoot | Out-Null
    $probePath = Join-Path $setupRoot ".write-test"
    [System.IO.File]::WriteAllText($probePath, "ok", [System.Text.Encoding]::ASCII)
    Remove-Item -LiteralPath $probePath -Force -ErrorAction SilentlyContinue
  } catch {
    throw "ISTUDIO needs to unpack setup files beside the installer, but this folder is not writable: $launcherDir. Move INSTALL-ISTUDIO.bat to a writable folder such as Desktop, Documents, or an external drive, then run it again."
  }

  $tempRoot = Join-Path $setupRoot ("setup-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
  return [pscustomobject]@{
    Root = $setupRoot
    Work = $tempRoot
  }
}

function Remove-LocalSetupTemp {
  param([object]$SetupTemp)

  if ($SetupTemp -and $SetupTemp.Root -and (Test-Path $SetupTemp.Root)) {
    Remove-Item -LiteralPath $SetupTemp.Root -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Find-PackageRoot {
  param([string]$ExtractPath)

  $expected = Join-Path $ExtractPath "ISTUDIO"
  if (Test-Path $expected) {
    return $expected
  }

  $directories = Get-ChildItem -LiteralPath $ExtractPath -Directory
  if ($directories.Count -eq 1) {
    return $directories[0].FullName
  }

  return $ExtractPath
}

function Assert-IStudioPackage {
  param([string]$PackageRoot)

  if (-not (Test-IStudioInstall -Path $PackageRoot)) {
    throw "The ISTUDIO installer package is incomplete. Download a fresh INSTALL-ISTUDIO.bat from GitHub Releases and run it again."
  }
}

function Export-EmbeddedPackage {
  param(
    [string]$InstallerPath,
    [string]$ZipPath
  )

  $payloadPath = Join-Path ([System.IO.Path]::GetDirectoryName($ZipPath)) "ISTUDIO-package.b64"
  $foundPayload = $false
  $payloadLines = 0
  $writer = [System.IO.StreamWriter]::new($payloadPath, $false, [System.Text.Encoding]::ASCII)
  try {
    foreach ($line in [System.IO.File]::ReadLines($InstallerPath)) {
      if ($foundPayload) {
        $clean = $line.Trim()
        if ($clean.Length -gt 0) {
          $writer.WriteLine($clean)
          $payloadLines++
        }
      } elseif ($line -eq "__ISTUDIO_PAYLOAD_B64__") {
        $foundPayload = $true
      }
    }
  } finally {
    $writer.Dispose()
  }

  if (-not $foundPayload -or $payloadLines -eq 0) {
    throw "This setup file does not include the ISTUDIO app package. Download the one-click installer from https://github.com/metadreamx/ISTUDIO/releases/latest/download/INSTALL-ISTUDIO.bat."
  }

  $payload = Get-Content -LiteralPath $payloadPath -Raw
  [System.IO.File]::WriteAllBytes($ZipPath, [Convert]::FromBase64String($payload))
}

function Install-IStudioPackage {
  param(
    [string]$PackageRoot,
    [string]$InstallDir
  )

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "projects") | Out-Null

  $preserve = @("projects", ".env.local", ".istudio-release")
  Get-ChildItem -LiteralPath $InstallDir -Force |
    Where-Object { $preserve -notcontains $_.Name } |
    Remove-Item -Recurse -Force

  Get-ChildItem -LiteralPath $PackageRoot -Force |
    ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination $InstallDir -Recurse -Force
    }
}

function New-IStudioShortcut {
  param([string]$InstallDir)

  try {
    $desktop = [Environment]::GetFolderPath("Desktop")
    if ([string]::IsNullOrWhiteSpace($desktop)) {
      return
    }

    $shortcutPath = Join-Path $desktop "ISTUDIO.lnk"
    $launcherBat = Join-Path $InstallDir "LAUNCH.bat"
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $launcherBat
    $shortcut.WorkingDirectory = $InstallDir
    $shortcut.Description = "Launch ISTUDIO"
    $shortcut.Save()
  } catch {
    Write-Host "Desktop shortcut could not be created. ISTUDIO is still installed." -ForegroundColor Yellow
  }
}

function Start-IStudio {
  param(
    [string]$InstallDir,
    [bool]$ShowMenu
  )

  $launcherScript = Join-Path $InstallDir "scripts\ISTUDIO-Launcher.ps1"
  if (-not (Test-Path $launcherScript)) {
    throw "ISTUDIO installed, but the launcher script is missing. Download a fresh installer and run it again."
  }

  if ($ShowMenu) {
    & $launcherScript
  } else {
    & $launcherScript -AutoLaunch
  }
  exit $LASTEXITCODE
}

$showMenu = $false
if (-not [string]::IsNullOrWhiteSpace($Mode)) {
  $normalizedMode = $Mode.ToLowerInvariant()
  $showMenu = $normalizedMode -eq "menu" -or $normalizedMode -eq "/menu" -or $normalizedMode -eq "--menu"
}

$installDir = Get-InstallDirectory -InstallerPath $Self
$script:SetupHeaderTitle = if (Test-IStudioInstall -Path $installDir) { "ISTUDIO Launcher" } else { "ISTUDIO Installer" }
$Host.UI.RawUI.WindowTitle = $script:SetupHeaderTitle

Write-SetupHeader -Subtitle "Reference-based photo editing, installed where you choose."
Write-Host "Install location" -ForegroundColor Gray
Write-Host "  $installDir" -ForegroundColor White
Write-Host ""
Write-Host "To install somewhere else, close this window, move INSTALL-ISTUDIO.bat to the folder you want, then run it again." -ForegroundColor DarkGray
Write-Host ""

if (Test-IStudioInstall -Path $installDir) {
  Write-Step -Number 1 -Total 1 -Message "ISTUDIO is already installed. Launching..."
  Start-Sleep -Milliseconds 500
  Start-IStudio -InstallDir $installDir -ShowMenu:$showMenu
}

$setupTemp = $null

try {
  $setupTemp = New-LocalSetupTemp -InstallerPath $Self
  $tempRoot = $setupTemp.Work
  $zipPath = Join-Path $tempRoot "ISTUDIO-windows.zip"
  $extractPath = Join-Path $tempRoot "extract"
  New-Item -ItemType Directory -Force -Path $extractPath | Out-Null

  Write-Step -Number 1 -Total 5 -Message "Preparing the bundled app package"
  Export-EmbeddedPackage -InstallerPath $Self -ZipPath $zipPath

  Write-Step -Number 2 -Total 5 -Message "Unpacking ISTUDIO"
  Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

  $packageRoot = Find-PackageRoot -ExtractPath $extractPath
  Assert-IStudioPackage -PackageRoot $packageRoot

  Write-Step -Number 3 -Total 5 -Message "Installing files"
  Install-IStudioPackage -PackageRoot $packageRoot -InstallDir $installDir

  Write-Step -Number 4 -Total 5 -Message "Creating desktop shortcut"
  New-IStudioShortcut -InstallDir $installDir

  Write-Step -Number 5 -Total 5 -Message "Launching ISTUDIO"
  Write-Host ""
  Write-Host "ISTUDIO is ready." -ForegroundColor Green
  Write-Host ""
  Remove-LocalSetupTemp -SetupTemp $setupTemp
  $setupTemp = $null
  Start-Sleep -Milliseconds 700
  Start-IStudio -InstallDir $installDir -ShowMenu:$showMenu
} catch {
  Write-Host ""
  Write-Host "ISTUDIO setup could not finish." -ForegroundColor Red
  Write-Host $_.Exception.Message
  Write-Host ""
  Write-Host "Download the latest installer from:" -ForegroundColor Gray
  Write-Host "https://github.com/metadreamx/ISTUDIO/releases/latest/download/INSTALL-ISTUDIO.bat" -ForegroundColor White
  Write-Host ""
  exit 1
} finally {
  Remove-LocalSetupTemp -SetupTemp $setupTemp
}

__ISTUDIO_PAYLOAD_B64__
