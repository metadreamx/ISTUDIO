[CmdletBinding()]
param(
  [string]$Repo = "metadreamx/ISTUDIO",
  [string]$ReleaseTag = "",
  [string]$NodeVersion = "22.15.0",
  [switch]$SkipChecks,
  [switch]$SkipPortableNode
)

$ErrorActionPreference = "Stop"

function Copy-RequiredItem {
  param(
    [string]$Name,
    [string]$Root,
    [string]$Destination
  )

  $source = Join-Path $Root $Name
  if (-not (Test-Path $source)) {
    throw "Required release item is missing: $Name"
  }

  $item = Get-Item -LiteralPath $source
  if ($item.PSIsContainer) {
    $target = Join-Path $Destination $Name
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    robocopy $source $target /E /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
    if ($LASTEXITCODE -gt 7) {
      throw "Failed to copy release directory: $Name"
    }
    $global:LASTEXITCODE = 0
  } else {
    $relativeDir = Split-Path $Name -Parent
    $targetDir = if ([string]::IsNullOrWhiteSpace($relativeDir)) {
      $Destination
    } else {
      Join-Path $Destination $relativeDir
    }
    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
    Copy-Item -LiteralPath $source -Destination $targetDir -Force
  }
}

function Write-ReleaseInstaller {
  param(
    [string]$Source,
    [string]$Destination,
    [string]$Repo,
    [string]$PackageZip
  )

  $content = Get-Content -LiteralPath $Source -Raw
  if (-not [string]::IsNullOrWhiteSpace($Repo)) {
    $content = $content.Replace("YOUR_GITHUB_USERNAME/ISTUDIO", $Repo)
    $content = $content.Replace("metadreamx/ISTUDIO", $Repo)
  }
  Set-Content -LiteralPath $Destination -Value $content -Encoding ascii

  if (-not (Test-Path $PackageZip)) {
    throw "Cannot embed missing package zip: $PackageZip"
  }

  $writer = [System.IO.StreamWriter]::new($Destination, $true, [System.Text.Encoding]::ASCII)
  try {
    $base64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($PackageZip))
    for ($i = 0; $i -lt $base64.Length; $i += 76) {
      $length = [Math]::Min(76, $base64.Length - $i)
      $writer.WriteLine($base64.Substring($i, $length))
    }
  } finally {
    $writer.Dispose()
  }
}

function Write-ReleasePackageJson {
  param(
    [string]$Root,
    [string]$Destination
  )

  $sourcePackage = Get-Content -LiteralPath (Join-Path $Root "package.json") -Raw | ConvertFrom-Json
  $releasePackage = [ordered]@{
    name = $sourcePackage.name
    version = $sourcePackage.version
    description = $sourcePackage.description
    private = $true
    type = "module"
  }

  $releasePackage | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $Destination "package.json") -Encoding ascii
}

function Assert-ReleasePackage {
  param(
    [string]$PackageRoot,
    [bool]$RequirePortableNode
  )

  $requiredPaths = @(
    "LAUNCH ISTUDIO.bat",
    "package.json",
    "dist-server\server.js",
    "dist\index.html",
    "scripts\ISTUDIO-Launcher.ps1",
    "node_modules"
  )

  if ($RequirePortableNode) {
    $requiredPaths += @(
      "runtime\node\node.exe",
      "runtime\node\npm.cmd"
    )
  }

  $missing = $requiredPaths | Where-Object {
    -not (Test-Path (Join-Path $PackageRoot $_))
  }

  if ($missing.Count -gt 0) {
    throw "Release package is incomplete. Missing: $($missing -join ', ')"
  }
}

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$releaseDir = Join-Path $root "release"
$stageRoot = Join-Path $releaseDir "stage"
$appStage = Join-Path $stageRoot "ISTUDIO"
$zipPath = Join-Path $releaseDir "ISTUDIO-windows.zip"
$batPath = Join-Path $releaseDir "LAUNCH-ISTUDIO.bat"

Push-Location $root
try {
  if (-not $SkipChecks) {
    npm ci
    npm run lint
    npm run build
  }

  if (-not (Test-Path (Join-Path $root "dist\index.html"))) {
    throw "dist/index.html is missing. Run npm run build before packaging."
  }
  if (-not (Test-Path (Join-Path $root "dist-server\server.js"))) {
    throw "dist-server/server.js is missing. Run npm run build before packaging."
  }
  if (-not (Test-Path (Join-Path $root "node_modules"))) {
    throw "node_modules is missing. Run npm ci before packaging."
  }

  if (Test-Path $stageRoot) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $appStage, $releaseDir | Out-Null

  $items = @(
    "LAUNCH ISTUDIO.bat",
    "README.md",
    "docs\assets",
    "dist",
    "dist-server",
    "scripts\ISTUDIO-Launcher.ps1",
    "node_modules"
  )

  foreach ($item in $items) {
    Copy-RequiredItem -Name $item -Root $root -Destination $appStage
  }
  Write-ReleasePackageJson -Root $root -Destination $appStage
  if ([string]::IsNullOrWhiteSpace($ReleaseTag)) {
    $releasePackage = Get-Content -LiteralPath (Join-Path $appStage "package.json") -Raw | ConvertFrom-Json
    $ReleaseTag = "v$($releasePackage.version)"
  }
  Set-Content -LiteralPath (Join-Path $appStage ".istudio-release") -Value $ReleaseTag -Encoding ascii

  New-Item -ItemType Directory -Force -Path (Join-Path $appStage "projects") | Out-Null

  if (-not $SkipPortableNode) {
    $runtimeDir = Join-Path $appStage "runtime"
    $nodeDir = Join-Path $runtimeDir "node"
    $nodeZip = Join-Path $releaseDir "node-v$NodeVersion-win-x64.zip"
    $nodeExtract = Join-Path $releaseDir "node-runtime"
    $nodeUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"

    if (Test-Path $nodeExtract) {
      Remove-Item -LiteralPath $nodeExtract -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $nodeDir, $nodeExtract | Out-Null

    if (-not (Test-Path $nodeZip)) {
      Write-Host "Downloading portable Node.js $NodeVersion..."
      Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeZip
    }

    Expand-Archive -Path $nodeZip -DestinationPath $nodeExtract -Force
    $expandedNode = Join-Path $nodeExtract "node-v$NodeVersion-win-x64"
    if (-not (Test-Path $expandedNode)) {
      throw "Portable Node.js archive did not expand as expected."
    }
    robocopy $expandedNode $nodeDir /E /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
    if ($LASTEXITCODE -gt 7) {
      throw "Failed to stage portable Node.js runtime."
    }
    $global:LASTEXITCODE = 0
  }

  Assert-ReleasePackage -PackageRoot $appStage -RequirePortableNode:(-not $SkipPortableNode)

  if (Test-Path $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }
  Push-Location $stageRoot
  try {
    tar.exe -a -cf $zipPath "ISTUDIO"
    if ($LASTEXITCODE -ne 0) {
      throw "tar.exe failed with exit code $LASTEXITCODE"
    }
  } catch {
    Write-Warning "tar.exe could not create the zip package. Falling back to Compress-Archive."
    Compress-Archive -Path $appStage -DestinationPath $zipPath -Force
  } finally {
    Pop-Location
  }

  if (-not (Test-Path $zipPath) -or (Get-Item $zipPath).Length -le 0) {
    throw "Release zip was not created correctly."
  }

  Write-ReleaseInstaller -Source (Join-Path $root "LAUNCH ISTUDIO.bat") -Destination $batPath -Repo $Repo -PackageZip $zipPath
  Remove-Item -LiteralPath (Join-Path $releaseDir "Install-ISTUDIO.bat") -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $releaseDir "Install-ISTUDIO.ps1") -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $releaseDir "ISTUDIO.bat") -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $releaseDir "ISTUDIO.exe") -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $releaseDir "LAUNCH ISTUDIO.bat") -Force -ErrorAction SilentlyContinue

  Write-Host ""
  Write-Host "Release package created:" -ForegroundColor Green
  Write-Host ("  " + $batPath)
} finally {
  Pop-Location
}
