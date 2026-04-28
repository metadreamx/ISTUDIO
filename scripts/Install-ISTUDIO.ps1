[CmdletBinding()]
param(
  [string]$Repo = "metadreamx/ISTUDIO",
  [string]$InstallDir = (Join-Path (Get-Location) "ISTUDIO"),
  [switch]$NoLaunch,
  [switch]$LaunchInline,
  [switch]$MenuInline
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Assert-SafeInstallDir {
  param([string]$Path)
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $root = [System.IO.Path]::GetPathRoot($fullPath)

  if ([string]::IsNullOrWhiteSpace($fullPath) -or $fullPath -eq $root -or $fullPath.Length -lt 8) {
    throw "InstallDir '$Path' is not a safe install folder."
  }

  return $fullPath
}

function New-LocalSetupTemp {
  param([string]$InstallDir)

  $baseDir = Split-Path -Parent ([System.IO.Path]::GetFullPath($InstallDir))
  $setupRoot = Join-Path $baseDir ".istudio-setup-temp"

  try {
    New-Item -ItemType Directory -Force -Path $setupRoot | Out-Null
    $probePath = Join-Path $setupRoot ".write-test"
    [System.IO.File]::WriteAllText($probePath, "ok", [System.Text.Encoding]::ASCII)
    Remove-Item -LiteralPath $probePath -Force -ErrorAction SilentlyContinue
  } catch {
    throw "ISTUDIO needs to unpack setup files beside the launcher, but this folder is not writable: $baseDir. Move LAUNCH-ISTUDIO.bat to a writable folder such as Desktop, Documents, or an external drive, then run it again."
  }

  $tempRoot = Join-Path $setupRoot ("install-" + [guid]::NewGuid())
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

function Get-LatestRelease {
  try {
    return Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers $headers -TimeoutSec 15
  } catch {
    $statusCode = $null
    if ($_.Exception.Response) {
      $statusCode = [int]$_.Exception.Response.StatusCode
    }

    if ($statusCode -eq 404) {
      try {
        Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo" -Headers $headers -TimeoutSec 15 | Out-Null
        throw "ISTUDIO release is not published yet. Download the latest LAUNCH-ISTUDIO.bat from GitHub Releases after the release is available."
      } catch {
        if ($_.Exception.Message -like "ISTUDIO release is not published yet*") {
          throw
        }
        throw "ISTUDIO release is not available. Download the latest LAUNCH-ISTUDIO.bat from GitHub Releases and run it again."
      }
    }

    throw "Could not reach ISTUDIO releases. Check your internet connection, then run LAUNCH-ISTUDIO.bat again. $($_.Exception.Message)"
  }
}

if ([string]::IsNullOrWhiteSpace($Repo)) {
  throw "The installer repo is not configured."
}

$InstallDir = Assert-SafeInstallDir -Path $InstallDir
$headers = @{ "User-Agent" = "ISTUDIO-Installer" }
$setupTemp = $null

try {
  $setupTemp = New-LocalSetupTemp -InstallDir $InstallDir
  $tempRoot = $setupTemp.Work
  $zipPath = Join-Path $tempRoot "ISTUDIO-windows.zip"
  $installerBatPath = Join-Path $tempRoot "LAUNCH-ISTUDIO.bat"
  $extractPath = Join-Path $tempRoot "extract"

  Write-Step "Finding the latest ISTUDIO release"
  $release = Get-LatestRelease
  $asset = Get-ReleaseZipAsset -Release $release
  $assetMode = "zip"
  if (-not $asset) {
    $asset = Get-ReleaseInstallerAsset -Release $release
    $assetMode = "bat"
  }
  if (-not $asset) {
    throw "The ISTUDIO release package is missing. Download the latest LAUNCH-ISTUDIO.bat from GitHub Releases and run it again."
  }

  New-Item -ItemType Directory -Force -Path $extractPath | Out-Null

  Write-Step "Downloading $($asset.name)"
  if ($assetMode -eq "zip") {
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -Headers $headers
  } else {
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $installerBatPath -Headers $headers
  }

  Write-Step "Preparing the update"
  if ($assetMode -eq "zip") {
    Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force
  } else {
    Expand-IStudioBatPackage -InstallerPath $installerBatPath -DestinationPath $extractPath
  }
  $packageRoot = Find-PackageRoot -ExtractPath $extractPath
  Assert-IStudioPackage -PackageRoot $packageRoot

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "projects") | Out-Null

  Write-Step "Installing ISTUDIO"
  $preserve = @("projects", ".env.local", ".istudio-release")
  Get-ChildItem -LiteralPath $InstallDir -Force |
    Where-Object { $preserve -notcontains $_.Name } |
    Remove-Item -Recurse -Force

  Get-ChildItem -LiteralPath $packageRoot -Force |
    ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination $InstallDir -Recurse -Force
    }

  Set-Content -LiteralPath (Join-Path $InstallDir ".istudio-release") -Value ([string]$release.tag_name) -Encoding ascii

  Write-Step "Creating the desktop launcher"
  try {
    $desktop = [Environment]::GetFolderPath("Desktop")
    if ($desktop) {
      $shortcutPath = Join-Path $desktop "ISTUDIO.lnk"
      $launcherBat = Join-Path $InstallDir "LAUNCH ISTUDIO.bat"
      $shell = New-Object -ComObject WScript.Shell
      $shortcut = $shell.CreateShortcut($shortcutPath)
      $shortcut.TargetPath = $launcherBat
      $shortcut.WorkingDirectory = $InstallDir
      $shortcut.Description = "Launch ISTUDIO"
      $shortcut.Save()
    }
  } catch {
    Write-Warning "ISTUDIO installed, but the desktop shortcut could not be created: $($_.Exception.Message)"
  }

  Write-Host ""
  Write-Host "ISTUDIO is installed at $InstallDir" -ForegroundColor Green

  if (-not $NoLaunch) {
    Write-Step "Launching ISTUDIO"
    if ($LaunchInline -or $MenuInline) {
      $launcherScript = Join-Path $InstallDir "scripts\ISTUDIO-Launcher.ps1"
      if (-not (Test-Path $launcherScript)) {
        throw "The ISTUDIO release package is incomplete. Download the latest LAUNCH-ISTUDIO.bat from GitHub Releases and run it again."
      }
      Remove-LocalSetupTemp -SetupTemp $setupTemp
      $setupTemp = $null
      if ($LaunchInline) {
        & $launcherScript -Repo $Repo -AutoLaunch
      } else {
        & $launcherScript -Repo $Repo
      }
      exit $LASTEXITCODE
    } else {
      $launcherBat = Join-Path $InstallDir "LAUNCH ISTUDIO.bat"
      Start-Process -FilePath $launcherBat -WorkingDirectory $InstallDir
    }
  }
} finally {
  Remove-LocalSetupTemp -SetupTemp $setupTemp
}

