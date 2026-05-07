@echo off
setlocal

title ISTUDIO
set "ISTUDIO_SELF=%~f0"
set "ISTUDIO_MODE=%~1"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; try { $self=$env:ISTUDIO_SELF; $mode=$env:ISTUDIO_MODE; $script=[System.Text.StringBuilder]::new(); $capture=$false; foreach($line in [System.IO.File]::ReadLines($self)){ if($line -eq '__ISTUDIO_PAYLOAD_B64__'){ break }; if($capture){ [void]$script.AppendLine($line) }; if($line -eq '__ISTUDIO_SETUP_PS1__'){ $capture=$true } }; $block=[scriptblock]::Create($script.ToString()); & $block -Self $self -Mode $mode; if($?){ exit 0 }; exit 1 } catch { Write-Host ''; Write-Host 'ISTUDIO setup error:' -ForegroundColor Red; Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 (
  echo.
  echo ISTUDIO setup did not complete. The error above explains what failed.
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
$script:Repo = "metadreamx/ISTUDIO"
$script:InstallerReleaseTag = "__ISTUDIO_RELEASE_TAG__"
$script:Headers = @{ "User-Agent" = "ISTUDIO-Installer" }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

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

function ConvertTo-Version {
  param([string]$Value)

  $clean = ($Value -replace "^v", "") -replace "[^\d.].*$", ""
  if ([string]::IsNullOrWhiteSpace($clean)) {
    return [version]"0.0.0"
  }

  try {
    return [version]$clean
  } catch {
    return [version]"0.0.0"
  }
}

function Get-InstallerVersion {
  if ([string]::IsNullOrWhiteSpace($script:InstallerReleaseTag) -or $script:InstallerReleaseTag -like "__*__") {
    return "0.0.0"
  }
  return $script:InstallerReleaseTag
}

function Get-InstalledVersion {
  param([string]$InstallDir)

  $releasePath = Join-Path $InstallDir ".istudio-release"
  if (Test-Path $releasePath) {
    try {
      $value = (Get-Content -LiteralPath $releasePath -Raw).Trim()
      if (-not [string]::IsNullOrWhiteSpace($value)) {
        return $value
      }
    } catch {
      # Fall back to package.json below.
    }
  }

  $packagePath = Join-Path $InstallDir "package.json"
  if (Test-Path $packagePath) {
    try {
      $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
      if ($package.version) {
        return [string]$package.version
      }
    } catch {
      # Unknown install version.
    }
  }

  return "0.0.0"
}

function Get-LatestRelease {
  try {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$script:Repo/releases/latest" -Headers $script:Headers -TimeoutSec 10
    return [pscustomobject]@{
      Status = "ok"
      Release = $release
      Message = $null
    }
  } catch {
    $statusCode = $null
    if ($_.Exception.Response) {
      $statusCode = [int]$_.Exception.Response.StatusCode
    }

    return [pscustomobject]@{
      Status = if ($statusCode -eq 404) { "no-release" } else { "unavailable" }
      Release = $null
      Message = $_.Exception.Message
    }
  }
}

function Get-ReleaseInstallerAsset {
  param([object]$Release)

  if (-not $Release -or -not $Release.assets) {
    return $null
  }

  $asset = $Release.assets | Where-Object { $_.name -eq "INSTALL-ISTUDIO.bat" } | Select-Object -First 1
  if (-not $asset) {
    $asset = $Release.assets | Where-Object { $_.name -like "*.bat" } | Select-Object -First 1
  }
  return $asset
}

function Test-IStudioInstallerFile {
  param([string]$InstallerPath)

  if (-not (Test-Path $InstallerPath)) {
    return $false
  }

  $hasScript = $false
  $hasPayload = $false
  foreach ($line in [System.IO.File]::ReadLines($InstallerPath)) {
    if ($line -eq "__ISTUDIO_SETUP_PS1__") {
      $hasScript = $true
    } elseif ($line -eq "__ISTUDIO_PAYLOAD_B64__") {
      $hasPayload = $true
      break
    }
  }
  return $hasScript -and $hasPayload
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

function Invoke-InstallerSelfUpdate {
  param(
    [string]$InstallerPath,
    [string]$InstallDir,
    [string]$Mode
  )

  if ([System.IO.Path]::GetFileName($InstallerPath) -ne "INSTALL-ISTUDIO.bat") {
    Write-Step -Number 1 -Total 1 -Message "Using local installer file"
    Write-Host "Installer self-update runs from the public INSTALL-ISTUDIO.bat release file." -ForegroundColor DarkGray
    return
  }

  Write-Step -Number 1 -Total 2 -Message "Checking for the latest ISTUDIO installer"
  $latest = Get-LatestRelease
  if ($latest.Status -ne "ok") {
    if ($latest.Status -eq "no-release") {
      Write-Host "No published ISTUDIO release was found yet. Continuing with this installer." -ForegroundColor DarkYellow
    } else {
      Write-Host "Could not check GitHub Releases. Continuing with this installer." -ForegroundColor DarkYellow
      if ($latest.Message) {
        Write-Host $latest.Message -ForegroundColor DarkGray
      }
    }
    return
  }

  $latestTag = [string]$latest.Release.tag_name
  $latestVersion = ConvertTo-Version $latestTag
  $installerVersion = ConvertTo-Version (Get-InstallerVersion)
  $installedVersion = if (Test-IStudioInstall -Path $InstallDir) {
    ConvertTo-Version (Get-InstalledVersion -InstallDir $InstallDir)
  } else {
    [version]"0.0.0"
  }

  Write-Host ("Latest release    : {0}" -f $latestTag) -ForegroundColor Green
  Write-Host ("Installer version : {0}" -f (Get-InstallerVersion)) -ForegroundColor Gray
  if (Test-IStudioInstall -Path $InstallDir) {
    Write-Host ("Installed version : {0}" -f (Get-InstalledVersion -InstallDir $InstallDir)) -ForegroundColor Gray
  }

  if ($latestVersion -le $installerVersion) {
    return
  }

  $asset = Get-ReleaseInstallerAsset -Release $latest.Release
  if (-not $asset) {
    Write-Host "The latest release does not include INSTALL-ISTUDIO.bat. Continuing with this installer." -ForegroundColor Yellow
    return
  }

  Write-Step -Number 2 -Total 2 -Message "Downloading the newest one-click installer"
  $setupTemp = $null
  try {
    $setupTemp = New-LocalSetupTemp -InstallerPath $InstallerPath
    $downloadPath = Join-Path $setupTemp.Work "INSTALL-ISTUDIO.bat"
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $downloadPath -Headers $script:Headers -TimeoutSec 120

    if (-not (Test-IStudioInstallerFile -InstallerPath $downloadPath)) {
      throw "The downloaded installer did not pass validation."
    }

    Copy-Item -LiteralPath $downloadPath -Destination $InstallerPath -Force
    Remove-LocalSetupTemp -SetupTemp $setupTemp
    $setupTemp = $null

    Write-Host ""
    Write-Host "Installer updated. Restarting with the latest ISTUDIO setup..." -ForegroundColor Green
    Write-Host ""
    Start-Sleep -Milliseconds 700

    if ([string]::IsNullOrWhiteSpace($Mode)) {
      & $InstallerPath
    } else {
      & $InstallerPath $Mode
    }
    exit $LASTEXITCODE
  } catch {
    Write-Host "Could not self-update the installer. Continuing with this installer." -ForegroundColor Yellow
    Write-Host $_.Exception.Message -ForegroundColor DarkGray
  } finally {
    Remove-LocalSetupTemp -SetupTemp $setupTemp
  }

  if ((Test-IStudioInstall -Path $InstallDir) -and $latestVersion -gt $installedVersion) {
    Write-Host "The installed app is older than GitHub Releases, but installer self-update was unavailable." -ForegroundColor Yellow
    Write-Host "This installer will still launch the installed app. Download the latest INSTALL-ISTUDIO.bat if the update does not apply." -ForegroundColor DarkGray
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
  if ($?) {
    exit 0
  }
  exit 1
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

Invoke-InstallerSelfUpdate -InstallerPath $Self -InstallDir $installDir -Mode $Mode
Write-Host ""

$installerVersionForInstall = ConvertTo-Version (Get-InstallerVersion)
$installedVersionForInstall = if (Test-IStudioInstall -Path $installDir) {
  ConvertTo-Version (Get-InstalledVersion -InstallDir $installDir)
} else {
  [version]"0.0.0"
}

if ((Test-IStudioInstall -Path $installDir) -and $installedVersionForInstall -ge $installerVersionForInstall) {
  Write-Step -Number 1 -Total 1 -Message "ISTUDIO is already installed. Launching..."
  Start-Sleep -Milliseconds 500
  Start-IStudio -InstallDir $installDir -ShowMenu:$showMenu
}

if (Test-IStudioInstall -Path $installDir) {
  Write-Step -Number 1 -Total 5 -Message "Updating installed ISTUDIO files from this installer"
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
