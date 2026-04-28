[CmdletBinding()]
param(
  [string]$Repo = $(if ($env:ISTUDIO_REPO) { $env:ISTUDIO_REPO } else { "metadreamx/ISTUDIO" }),
  [int]$Port = 4217
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppDir = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$ProjectsDir = if ($env:ISTUDIO_PROJECTS_DIR) { $env:ISTUDIO_PROJECTS_DIR } else { Join-Path $AppDir "projects" }
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
    Write-Host "Latest version    : no GitHub Release published" -ForegroundColor DarkYellow
  } elseif ($UpdateState -and $UpdateState.Status -eq "repo-unavailable") {
    Write-Host "Latest version    : GitHub repo unavailable" -ForegroundColor DarkYellow
  } elseif ($UpdateState -and $UpdateState.Status -eq "unavailable") {
    Write-Host "Latest version    : update check unavailable" -ForegroundColor DarkYellow
  } else {
    Write-Host "Latest version    : checking disabled" -ForegroundColor DarkGray
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
          Message = "The GitHub repository exists, but it does not have a published Release yet."
        }
      } catch {
        return [pscustomobject]@{
          Status = "repo-unavailable"
          Release = $null
          Message = "GitHub could not find $Repo. The repository may be private, renamed, or not pushed yet."
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

function Quote-Argument {
  param([string]$Value)
  return '"' + ($Value -replace '"', '\"') + '"'
}

function Start-UpdateApply {
  param(
    [string]$PackageRoot,
    [string]$TagName,
    [string]$TempRoot
  )

  $applyScript = Join-Path $TempRoot "Apply-ISTUDIO-Update.ps1"
  $script = @'
param(
  [string]$PackageRoot,
  [string]$InstallDir,
  [string]$TagName
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

try {
  Start-Sleep -Seconds 2
  Write-Step "Applying ISTUDIO update $TagName"

  if (-not (Test-Path $PackageRoot)) {
    throw "Downloaded package folder was not found."
  }

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "projects") | Out-Null

  $preserve = @("projects", ".env.local")
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
  Start-Process -FilePath (Join-Path $InstallDir "ISTUDIO.bat") -WorkingDirectory $InstallDir
} catch {
  Write-Host ""
  Write-Host "ISTUDIO update failed." -ForegroundColor Red
  Write-Host $_.Exception.Message
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
    "-TagName $(Quote-Argument $TagName)"
  ) -join " "

  Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -WorkingDirectory $TempRoot
}

function Install-Update {
  param([object]$Release)

  $asset = Get-ReleaseZipAsset -Release $Release
  if (-not $asset) {
    Write-Host "No ISTUDIO-windows.zip asset was found on the latest release." -ForegroundColor Red
    Pause-Launcher
    return
  }

  $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("istudio-update-" + [guid]::NewGuid())
  $zipPath = Join-Path $tempRoot "ISTUDIO-windows.zip"
  $extractPath = Join-Path $tempRoot "extract"

  New-Item -ItemType Directory -Force -Path $tempRoot, $extractPath | Out-Null

  Write-Host ""
  Write-Host ("Downloading {0}..." -f $asset.name) -ForegroundColor Cyan
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -Headers $Headers

  Write-Host "Preparing update..." -ForegroundColor Cyan
  Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

  $packageRoot = Find-PackageRoot -ExtractPath $extractPath
  Start-UpdateApply -PackageRoot $packageRoot -TagName ([string]$Release.tag_name) -TempRoot $tempRoot

  Write-Host ""
  Write-Host "The updater is applying the new version in a separate window." -ForegroundColor Green
  Write-Host "This launcher will close now."
  Start-Sleep -Seconds 2
  exit 0
}

function Check-ForUpdates {
  Write-LauncherHeader $null
  Write-Host "Checking GitHub releases for updates..." -ForegroundColor Cyan
  $state = Get-UpdateState

  if ($state.Status -eq "no-release") {
    Write-Host ""
    Write-Host "No GitHub Release has been published for ISTUDIO yet." -ForegroundColor Yellow
    Write-Host "Push a version tag such as v1.0.1, then let GitHub Actions create the release package."
    Write-Host ""
    Write-Host "Commands:"
    Write-Host "  git tag v1.0.1"
    Write-Host "  git push origin v1.0.1"
    Pause-Launcher
    return $state
  }

  if ($state.Status -eq "repo-unavailable") {
    Write-Host ""
    Write-Host "GitHub could not find metadreamx/ISTUDIO from this launcher." -ForegroundColor Yellow
    Write-Host "Make sure the repo is public or publish releases from a public repo users can access."
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
    $env:PATH = "$nodeDir;$env:PATH"
  }
}

function Get-NpmCommand {
  Add-PortableNodeToPath
  $npm = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
  if (-not $npm) {
    throw "npm was not found. Install Node.js 22 or install ISTUDIO from the release installer."
  }
  return $npm.Source
}

function Ensure-AppReady {
  $node = Get-Command "node.exe" -ErrorAction SilentlyContinue
  if (-not $node) {
    Add-PortableNodeToPath
    $node = Get-Command "node.exe" -ErrorAction SilentlyContinue
  }

  if (-not $node) {
    throw "Node.js was not found. Install Node.js 22 or install ISTUDIO from the release installer."
  }

  $npm = Get-NpmCommand

  if (-not (Test-Path (Join-Path $AppDir "node_modules"))) {
    Write-Host ""
    Write-Host "Installing ISTUDIO dependencies..." -ForegroundColor Cyan
    & $npm install
    if ($LASTEXITCODE -ne 0) {
      throw "Dependency installation failed."
    }
  }

  if (-not (Test-Path (Join-Path $AppDir "dist\index.html"))) {
    Write-Host ""
    Write-Host "Building ISTUDIO for production..." -ForegroundColor Cyan
    & $npm run build
    if ($LASTEXITCODE -ne 0) {
      throw "Production build failed."
    }
  }

  return $npm
}

function Launch-IStudio {
  Write-LauncherHeader $script:UpdateState
  Write-Host "Starting ISTUDIO..." -ForegroundColor Cyan

  $npm = Ensure-AppReady
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
    & $npm run start
  } finally {
    Pop-Location
  }
}

function Open-ProjectsFolder {
  New-Item -ItemType Directory -Force -Path $ProjectsDir | Out-Null
  Start-Process -FilePath $ProjectsDir
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
