[CmdletBinding()]
param(
  [string]$Repo = $(if ($env:ISTUDIO_REPO) { $env:ISTUDIO_REPO } else { "metadreamx/ISTUDIO" }),
  [int]$Port = 4217,
  [switch]$AutoLaunch
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$ProjectsDir = Join-Path $AppDir "projects"
$Headers = @{ "User-Agent" = "ISTUDIO-Launcher" }

function Write-LauncherHeader {
  param([object]$UpdateState)

  Clear-Host
  Write-Host ""
  Write-Host "========================================" -ForegroundColor DarkGray
  Write-Host "  ISTUDIO by Iconic Recordings" -ForegroundColor White
  Write-Host "========================================" -ForegroundColor DarkGray
  Write-Host ""
  Write-Host "Reference-based photo editing from the visual DNA of another image."
  Write-Host ""
  Write-Host ("Installed version : {0}" -f (Get-CurrentVersion))
  if ($UpdateState -and $UpdateState.Status -eq "available") {
    Write-Host ("Latest version    : {0} available" -f $UpdateState.LatestTag) -ForegroundColor Yellow
  } elseif ($UpdateState -and $UpdateState.Status -eq "current") {
    Write-Host ("Latest version    : {0} installed" -f $UpdateState.LatestTag) -ForegroundColor Green
  } elseif ($UpdateState -and $UpdateState.Status -eq "no-release") {
    Write-Host "Latest version    : ISTUDIO release is not published yet" -ForegroundColor DarkYellow
  } elseif ($UpdateState -and $UpdateState.Status -eq "repo-unavailable") {
    Write-Host "Latest version    : ISTUDIO release is not available" -ForegroundColor DarkYellow
  } elseif ($UpdateState -and $UpdateState.Status -eq "unavailable") {
    Write-Host "Latest version    : update check unavailable" -ForegroundColor DarkYellow
  } elseif ($UpdateState -and $UpdateState.Status -eq "checking") {
    Write-Host "Latest version    : checking..." -ForegroundColor Cyan
  } else {
    Write-Host "Latest version    : will check before launch" -ForegroundColor DarkGray
  }
  Write-Host ""
}

function Pause-Launcher {
  Write-Host ""
  Read-Host "Press Enter to continue" | Out-Null
}

function Get-CurrentVersion {
  $releasePath = Join-Path $AppDir ".istudio-release"
  if (Test-Path $releasePath) {
    try {
      $releaseVersion = (Get-Content -LiteralPath $releasePath -Raw).Trim()
      if (-not [string]::IsNullOrWhiteSpace($releaseVersion)) {
        return $releaseVersion
      }
    } catch {
      # Fall back to package.json below.
    }
  }

  $packagePath = Join-Path $AppDir "package.json"
  if (-not (Test-Path $packagePath)) {
    return "0.0.0"
  }
  try {
    $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    return [string]$package.version
  } catch {
    return "0.0.0"
  }
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

function Get-LatestRelease {
  param([switch]$Quiet)

  try {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers $Headers -TimeoutSec 10
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

    if ($statusCode -eq 404) {
      try {
        Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo" -Headers $Headers -TimeoutSec 10 | Out-Null
        return [pscustomobject]@{
          Status = "no-release"
          Release = $null
          Message = "ISTUDIO release is not published yet."
        }
      } catch {
        return [pscustomobject]@{
          Status = "repo-unavailable"
          Release = $null
          Message = "ISTUDIO release is not available."
        }
      }
    }

    if (-not $Quiet) {
      Write-Warning "Could not reach GitHub releases for $Repo. $($_.Exception.Message)"
    }
    return [pscustomobject]@{
      Status = "unavailable"
      Release = $null
      Message = $_.Exception.Message
    }
  }
}

function Get-UpdateState {
  param([switch]$Quiet)

  $latest = Get-LatestRelease -Quiet:$Quiet
  if ($latest.Status -ne "ok") {
    return [pscustomobject]@{
      Status = $latest.Status
      Release = $null
      LatestTag = $null
      Message = $latest.Message
    }
  }

  $release = $latest.Release
  $current = ConvertTo-Version (Get-CurrentVersion)
  $latest = ConvertTo-Version ([string]$release.tag_name)
  $status = if ($latest -gt $current) { "available" } else { "current" }

  return [pscustomobject]@{
    Status = $status
    Release = $release
    LatestTag = [string]$release.tag_name
    Message = $null
  }
}

function Get-ReleaseZipAsset {
  param([object]$Release)

  if (-not $Release -or -not $Release.assets) {
    return $null
  }

  $asset = $Release.assets | Where-Object { $_.name -eq "ISTUDIO-windows.zip" } | Select-Object -First 1
  if (-not $asset) {
    $asset = $Release.assets | Where-Object { $_.name -like "*.zip" } | Select-Object -First 1
  }
  return $asset
}

function Get-ReleaseInstallerAsset {
  param([object]$Release)

  if (-not $Release -or -not $Release.assets) {
    return $null
  }

  return $Release.assets | Where-Object { $_.name -like "*.bat" } | Select-Object -First 1
}

function Expand-IStudioBatPackage {
  param(
    [string]$InstallerPath,
    [string]$DestinationPath
  )

  $payloadPath = Join-Path ([System.IO.Path]::GetDirectoryName($InstallerPath)) "ISTUDIO-package.b64"
  $zipFromBat = Join-Path ([System.IO.Path]::GetDirectoryName($InstallerPath)) "ISTUDIO-windows.zip"
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
    throw "The ISTUDIO installer package is incomplete. Download the latest LAUNCH-ISTUDIO.bat from GitHub Releases and run it again."
  }

  $payload = Get-Content -LiteralPath $payloadPath -Raw
  [System.IO.File]::WriteAllBytes($zipFromBat, [Convert]::FromBase64String($payload))
  Expand-Archive -Path $zipFromBat -DestinationPath $DestinationPath -Force
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

  $requiredPaths = @(
    "LAUNCH ISTUDIO.bat",
    "package.json",
    "dist-server\server.js",
    "dist\index.html",
    "scripts\ISTUDIO-Launcher.ps1",
    "node_modules",
    "runtime\node\node.exe",
    "runtime\node\npm.cmd"
  )

  $missing = $requiredPaths | Where-Object {
    -not (Test-Path (Join-Path $PackageRoot $_))
  }

  if ($missing.Count -gt 0) {
    throw "The ISTUDIO release package is incomplete. Download the latest LAUNCH-ISTUDIO.bat from GitHub Releases and run it again. Missing: $($missing -join ', ')"
  }
}

function Quote-Argument {
  param([string]$Value)
  return '"' + ($Value -replace '"', '\"') + '"'
}

function New-LocalSetupTemp {
  $baseDir = Split-Path -Parent $AppDir
  $setupRoot = Join-Path $baseDir ".istudio-setup-temp"

  try {
    New-Item -ItemType Directory -Force -Path $setupRoot | Out-Null
    $probePath = Join-Path $setupRoot ".write-test"
    [System.IO.File]::WriteAllText($probePath, "ok", [System.Text.Encoding]::ASCII)
    Remove-Item -LiteralPath $probePath -Force -ErrorAction SilentlyContinue
  } catch {
    throw "ISTUDIO needs to unpack update files beside the installed app, but this folder is not writable: $baseDir. Move the ISTUDIO folder to a writable location such as Desktop, Documents, or an external drive, then run it again."
  }

  $tempRoot = Join-Path $setupRoot ("update-" + [guid]::NewGuid())
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

function Start-UpdateApply {
  param(
    [string]$PackageRoot,
    [string]$TagName,
    [string]$TempRoot,
    [string]$SetupRoot
  )

  $applyScript = Join-Path $TempRoot "Apply-ISTUDIO-Update.ps1"
  $script = @'
param(
  [string]$PackageRoot,
  [string]$InstallDir,
  [string]$TagName,
  [string]$SetupRoot
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Assert-IStudioPackage {
  param([string]$PackageRoot)

  $requiredPaths = @(
    "LAUNCH ISTUDIO.bat",
    "package.json",
    "dist-server\server.js",
    "dist\index.html",
    "scripts\ISTUDIO-Launcher.ps1",
    "node_modules",
    "runtime\node\node.exe",
    "runtime\node\npm.cmd"
  )

  $missing = $requiredPaths | Where-Object {
    -not (Test-Path (Join-Path $PackageRoot $_))
  }

  if ($missing.Count -gt 0) {
    throw "The ISTUDIO release package is incomplete. Download the latest LAUNCH-ISTUDIO.bat from GitHub Releases and run it again. Missing: $($missing -join ', ')"
  }
}

function Remove-SetupRoot {
  if ($SetupRoot -and (Test-Path $SetupRoot)) {
    Remove-Item -LiteralPath $SetupRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

try {
  Start-Sleep -Seconds 2
  Write-Step "Applying ISTUDIO update $TagName"

  Assert-IStudioPackage -PackageRoot $PackageRoot

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

  Set-Content -LiteralPath (Join-Path $InstallDir ".istudio-release") -Value $TagName -Encoding ascii
  Write-Host ""
  Write-Host "ISTUDIO has been updated." -ForegroundColor Green
  Write-Host "Launching the updated app..."
  Start-Sleep -Seconds 1
  $launcherBat = Join-Path $InstallDir "LAUNCH ISTUDIO.bat"
  Remove-SetupRoot
  Start-Process -FilePath $launcherBat -WorkingDirectory $InstallDir
} catch {
  Write-Host ""
  Write-Host "ISTUDIO update failed." -ForegroundColor Red
  Write-Host $_.Exception.Message
  Remove-SetupRoot
  Write-Host ""
  Read-Host "Press Enter to close" | Out-Null
  exit 1
}
'@

  Set-Content -LiteralPath $applyScript -Value $script -Encoding ascii

  $arguments = @(
    "-NoProfile",
    "-ExecutionPolicy Bypass",
    "-File $(Quote-Argument $applyScript)",
    "-PackageRoot $(Quote-Argument $PackageRoot)",
    "-InstallDir $(Quote-Argument $AppDir)",
    "-TagName $(Quote-Argument $TagName)",
    "-SetupRoot $(Quote-Argument $SetupRoot)"
  ) -join " "

  Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -WorkingDirectory (Split-Path -Parent $AppDir)
}

function Install-Update {
  param(
    [object]$Release,
    [switch]$Automatic
  )

  $asset = Get-ReleaseZipAsset -Release $Release
  $assetMode = "zip"
  if (-not $asset) {
    $asset = Get-ReleaseInstallerAsset -Release $Release
    $assetMode = "bat"
  }
  if (-not $asset) {
    Write-Host "No ISTUDIO installer was found on the latest release." -ForegroundColor Red
    Write-Host "Download the latest LAUNCH-ISTUDIO.bat from GitHub Releases and run it again."
    if (-not $Automatic) {
      Pause-Launcher
    }
    return
  }

  $setupTemp = $null

  try {
    $setupTemp = New-LocalSetupTemp
    $tempRoot = $setupTemp.Work
    $zipPath = Join-Path $tempRoot "ISTUDIO-windows.zip"
    $installerBatPath = Join-Path $tempRoot "LAUNCH-ISTUDIO.bat"
    $extractPath = Join-Path $tempRoot "extract"

    New-Item -ItemType Directory -Force -Path $extractPath | Out-Null

    Write-Host ""
    Write-Host ("Downloading {0}..." -f $asset.name) -ForegroundColor Cyan
    if ($assetMode -eq "zip") {
      Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -Headers $Headers
    } else {
      Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $installerBatPath -Headers $Headers
    }

    Write-Host "Preparing update..." -ForegroundColor Cyan
    if ($assetMode -eq "zip") {
      Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force
    } else {
      Expand-IStudioBatPackage -InstallerPath $installerBatPath -DestinationPath $extractPath
    }

    $packageRoot = Find-PackageRoot -ExtractPath $extractPath
    Assert-IStudioPackage -PackageRoot $packageRoot
    Start-UpdateApply -PackageRoot $packageRoot -TagName ([string]$Release.tag_name) -TempRoot $tempRoot -SetupRoot $setupTemp.Root
    $setupTemp = $null

    Write-Host ""
    Write-Host "The updater is applying the new version in a separate window." -ForegroundColor Green
    Write-Host "This launcher will close now."
    Start-Sleep -Seconds 2
    exit 0
  } catch {
    Remove-LocalSetupTemp -SetupTemp $setupTemp
    throw
  }
}

function Invoke-LaunchUpdateCheck {
  Write-LauncherHeader ([pscustomobject]@{ Status = "checking" })
  Write-Host "Checking for ISTUDIO updates..." -ForegroundColor Cyan
  $state = Get-UpdateState -Quiet
  $script:UpdateState = $state

  if ($state.Status -eq "available") {
    Write-Host ""
    Write-Host ("Update available: {0}" -f $state.LatestTag) -ForegroundColor Yellow
    Write-Host "Installing the latest ISTUDIO before launch..."
    try {
      Install-Update -Release $state.Release -Automatic
    } catch {
      Write-Host ""
      Write-Host "Automatic update could not finish. Launching the installed version." -ForegroundColor Yellow
      Write-Host $_.Exception.Message
      Start-Sleep -Seconds 2
    }
    return
  }

  if ($state.Status -eq "current") {
    Write-Host ""
    Write-Host ("ISTUDIO is up to date: {0}" -f $state.LatestTag) -ForegroundColor Green
    Start-Sleep -Milliseconds 700
    return
  }

  Write-Host ""
  if ($state.Status -eq "no-release") {
    Write-Host "ISTUDIO release is not published yet. Launching the installed version." -ForegroundColor DarkYellow
  } elseif ($state.Status -eq "repo-unavailable") {
    Write-Host "ISTUDIO release is not available. Launching the installed version." -ForegroundColor DarkYellow
  } else {
    Write-Host "Update check unavailable. Launching the installed version." -ForegroundColor DarkYellow
    if ($state.Message) {
      Write-Host $state.Message
    }
  }
  Start-Sleep -Seconds 2
}

function Check-ForUpdates {
  Write-LauncherHeader $null
  Write-Host "Checking GitHub releases for updates..." -ForegroundColor Cyan
  $state = Get-UpdateState

  if ($state.Status -eq "no-release") {
    Write-Host ""
    Write-Host "ISTUDIO release is not published yet." -ForegroundColor Yellow
    Write-Host "Download the latest LAUNCH-ISTUDIO.bat from GitHub Releases after the release is available."
    Pause-Launcher
    return $state
  }

  if ($state.Status -eq "repo-unavailable") {
    Write-Host ""
    Write-Host "ISTUDIO release is not available." -ForegroundColor Yellow
    Write-Host "Download the latest LAUNCH-ISTUDIO.bat from GitHub Releases and run it again."
    Pause-Launcher
    return $state
  }

  if ($state.Status -eq "unavailable") {
    Write-Host ""
    Write-Host "Update check unavailable. Check your internet connection or try again later." -ForegroundColor Yellow
    if ($state.Message) {
      Write-Host $state.Message
    }
    Pause-Launcher
    return $state
  }

  if ($state.Status -eq "current") {
    Write-Host ""
    Write-Host ("ISTUDIO is up to date. Current release: {0}" -f $state.LatestTag) -ForegroundColor Green
    Pause-Launcher
    return $state
  }

  Write-Host ""
  Write-Host ("A new ISTUDIO update is available: {0}" -f $state.LatestTag) -ForegroundColor Yellow
  $answer = Read-Host "Install this update now? (Y/N)"
  if ($answer -match "^[Yy]") {
    Install-Update -Release $state.Release
  }

  return $state
}

function Add-PortableNodeToPath {
  $nodeDir = Join-Path $AppDir "runtime\node"
  if (Test-Path (Join-Path $nodeDir "node.exe")) {
    $npmBin = Join-Path $nodeDir "node_modules\npm\bin"
    $env:PATH = "$nodeDir;$npmBin;$env:PATH"
    return $true
  }
  return $false
}

function Assert-InstalledReleasePackage {
  $requiredPaths = @(
    "runtime\node\node.exe",
    "runtime\node\npm.cmd",
    "LAUNCH ISTUDIO.bat",
    "node_modules",
    "dist-server\server.js",
    "dist\index.html",
    "scripts\ISTUDIO-Launcher.ps1",
    "package.json"
  )

  $missing = $requiredPaths | Where-Object {
    -not (Test-Path (Join-Path $AppDir $_))
  }

  if ($missing.Count -gt 0) {
    throw "This ISTUDIO install is incomplete. Download the latest LAUNCH-ISTUDIO.bat from GitHub Releases and run it again. Missing: $($missing -join ', ')."
  }
}

function Ensure-AppReady {
  $hasPortableNode = Add-PortableNodeToPath
  Assert-InstalledReleasePackage

  $node = Join-Path $AppDir "runtime\node\node.exe"

  if (-not $hasPortableNode -or -not (Test-Path $node)) {
    throw "ISTUDIO is missing its bundled runtime. Download the latest LAUNCH-ISTUDIO.bat from GitHub Releases and run it again."
  }

  if (-not (Test-Path (Join-Path $AppDir "node_modules"))) {
    throw "ISTUDIO is missing bundled app files. Download the latest LAUNCH-ISTUDIO.bat from GitHub Releases and run it again."
  }

  if (-not (Test-Path (Join-Path $AppDir "dist\index.html"))) {
    throw "ISTUDIO is missing bundled app files. Download the latest LAUNCH-ISTUDIO.bat from GitHub Releases and run it again."
  }

  if (-not (Test-Path (Join-Path $AppDir "dist-server\server.js"))) {
    throw "ISTUDIO is missing bundled app files. Download the latest LAUNCH-ISTUDIO.bat from GitHub Releases and run it again."
  }

  $script:NodeCommand = $node
}

function Launch-IStudio {
  if (-not $script:UpdateState) {
    Invoke-LaunchUpdateCheck
  }

  Write-LauncherHeader $script:UpdateState
  Write-Host "Starting ISTUDIO..." -ForegroundColor Cyan

  Ensure-AppReady
  $node = $script:NodeCommand
  New-Item -ItemType Directory -Force -Path $ProjectsDir | Out-Null

  $env:NODE_ENV = "production"
  $env:PORT = [string]$Port
  $env:ISTUDIO_PROJECTS_DIR = $ProjectsDir

  $url = "http://localhost:$Port/"
  Write-Host ""
  Write-Host "Starting ISTUDIO at $url"
  Write-Host ""
  Write-Host "Keep this window open while using ISTUDIO."
  Write-Host "Close it to stop the app."
  Write-Host ""

  $openCommand = "Start-Sleep -Seconds 3; Start-Process '$url'"
  Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -ArgumentList "-NoProfile -Command $([char]34)$openCommand$([char]34)"

  Push-Location $AppDir
  try {
    & $node "dist-server/server.js"
  } finally {
    Pop-Location
  }
}

function Open-ProjectsFolder {
  New-Item -ItemType Directory -Force -Path $ProjectsDir | Out-Null
  Start-Process -FilePath $ProjectsDir
}

if ($AutoLaunch) {
  Invoke-LaunchUpdateCheck
  Launch-IStudio
  exit $LASTEXITCODE
}

$script:UpdateState = Get-UpdateState -Quiet

while ($true) {
  Write-LauncherHeader $script:UpdateState
  Write-Host "Choose an option:"
  Write-Host ""
  Write-Host "  1. Launch ISTUDIO"
  Write-Host "  2. Check for updates"
  Write-Host "  3. Open projects folder"
  Write-Host "  4. Exit"
  Write-Host ""

  $choice = Read-Host "Enter 1, 2, 3, or 4"

  switch ($choice) {
    "1" {
      Invoke-LaunchUpdateCheck
      Launch-IStudio
      exit $LASTEXITCODE
    }
    "2" {
      $script:UpdateState = Check-ForUpdates
    }
    "3" {
      Open-ProjectsFolder
    }
    "4" {
      exit 0
    }
    default {
      Write-Host ""
      Write-Host "Choose 1, 2, 3, or 4." -ForegroundColor Yellow
      Start-Sleep -Seconds 1
    }
  }
}

