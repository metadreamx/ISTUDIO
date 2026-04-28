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
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers $headers
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
  $packageRoot = Join-Path $extractPath "ISTUDIO"
  if (-not (Test-Path $packageRoot)) {
    $directories = Get-ChildItem -LiteralPath $extractPath -Directory
    if ($directories.Count -eq 1) {
      $packageRoot = $directories[0].FullName
    } else {
      $packageRoot = $extractPath
    }
  }

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "projects") | Out-Null

  Write-Step "Installing ISTUDIO"
  $preserve = @("projects", ".env.local")
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
      $shell = New-Object -ComObject WScript.Shell
      $shortcut = $shell.CreateShortcut($shortcutPath)
      $shortcut.TargetPath = Join-Path $InstallDir "ISTUDIO.bat"
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
    Start-Process -FilePath (Join-Path $InstallDir "ISTUDIO.bat") -WorkingDirectory $InstallDir
  }
} finally {
  if (Test-Path $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
