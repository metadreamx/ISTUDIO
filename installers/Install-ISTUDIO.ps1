[CmdletBinding()]
param(
  [string]$Repo = "metadreamx/ISTUDIO",
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "ISTUDIO"),
  [switch]$NoLaunch
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
    "ISTUDIO.bat",
    "ISTUDIO.exe",
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
    throw "The downloaded ISTUDIO package is incomplete. Missing: $($missing -join ', ')"
  }
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
        throw "No GitHub Release has been published for ISTUDIO yet. Push a version tag, wait for GitHub Actions to finish, then run this installer again."
      } catch {
        if ($_.Exception.Message -like "No GitHub Release*") {
          throw
        }
        throw "GitHub could not find $Repo. Make sure the repository is public and the installer is pointed at the right repo."
      }
    }

    throw "Could not reach GitHub releases for $Repo. Check your internet connection and try again. $($_.Exception.Message)"
  }
}

if ([string]::IsNullOrWhiteSpace($Repo)) {
  throw "The installer repo is not configured."
}

$InstallDir = Assert-SafeInstallDir -Path $InstallDir
$headers = @{ "User-Agent" = "ISTUDIO-Installer" }
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("istudio-install-" + [guid]::NewGuid())
$zipPath = Join-Path $tempRoot "ISTUDIO-windows.zip"
$extractPath = Join-Path $tempRoot "extract"

try {
  Write-Step "Finding the latest ISTUDIO release"
  $release = Get-LatestRelease
  $asset = $release.assets | Where-Object { $_.name -eq "ISTUDIO-windows.zip" } | Select-Object -First 1
  if (-not $asset) {
    $asset = $release.assets | Where-Object { $_.name -like "*.zip" } | Select-Object -First 1
  }
  if (-not $asset) {
    throw "No Windows zip asset was found on the latest GitHub release."
  }

  New-Item -ItemType Directory -Force -Path $tempRoot, $extractPath | Out-Null

  Write-Step "Downloading $($asset.name)"
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -Headers $headers

  Write-Step "Preparing the update"
  Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force
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
      $launcherExe = Join-Path $InstallDir "ISTUDIO.exe"
      $launcherBat = Join-Path $InstallDir "ISTUDIO.bat"
      $shell = New-Object -ComObject WScript.Shell
      $shortcut = $shell.CreateShortcut($shortcutPath)
      $shortcut.TargetPath = if (Test-Path $launcherExe) { $launcherExe } else { $launcherBat }
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
    $launcherExe = Join-Path $InstallDir "ISTUDIO.exe"
    $launcherBat = Join-Path $InstallDir "ISTUDIO.bat"
    $launcherPath = if (Test-Path $launcherExe) { $launcherExe } else { $launcherBat }
    Start-Process -FilePath $launcherPath -WorkingDirectory $InstallDir
  }
} finally {
  if (Test-Path $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
