[CmdletBinding()]
param(
  [string]$Repo = "metadreamx/ISTUDIO",
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
    $target = Join-Path $Destination $item.Name
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    robocopy $source $target /E /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
    if ($LASTEXITCODE -gt 7) {
      throw "Failed to copy release directory: $Name"
    }
    $global:LASTEXITCODE = 0
  } else {
    Copy-Item -LiteralPath $source -Destination $Destination -Force
  }
}

function Write-ReleaseInstaller {
  param(
    [string]$Source,
    [string]$Destination,
    [string]$Repo
  )

  $content = Get-Content -LiteralPath $Source -Raw
  if (-not [string]::IsNullOrWhiteSpace($Repo)) {
    $content = $content.Replace("YOUR_GITHUB_USERNAME/ISTUDIO", $Repo)
    $content = $content.Replace("metadreamx/ISTUDIO", $Repo)
  }
  Set-Content -LiteralPath $Destination -Value $content -Encoding ascii
}

function Assert-ReleasePackage {
  param(
    [string]$PackageRoot,
    [bool]$RequirePortableNode
  )

  $requiredPaths = @(
    "ISTUDIO.bat",
    "Install-ISTUDIO.bat",
    "package.json",
    "server.ts",
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
    ".env.example",
    "App.tsx",
    "index.css",
    "index.html",
    "index.tsx",
    "ISTUDIO.bat",
    "Install-ISTUDIO.bat",
    "manifest.json",
    "metadata.json",
    "package.json",
    "package-lock.json",
    "presets.ts",
    "README.md",
    "server.ts",
    "sw.js",
    "tsconfig.json",
    "types.ts",
    "vite.config.ts",
    "components",
    "data",
    "dist",
    "dist-server",
    "docs",
    "installers",
    "public",
    "scripts",
    "services",
    "src",
    "types",
    "node_modules"
  )

  foreach ($item in $items) {
    Copy-RequiredItem -Name $item -Root $root -Destination $appStage
  }

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

  Write-ReleaseInstaller -Source (Join-Path $root "installers\Install-ISTUDIO.bat") -Destination (Join-Path $releaseDir "Install-ISTUDIO.bat") -Repo $Repo
  Write-ReleaseInstaller -Source (Join-Path $root "installers\Install-ISTUDIO.ps1") -Destination (Join-Path $releaseDir "Install-ISTUDIO.ps1") -Repo $Repo

  Write-Host ""
  Write-Host "Release package created:" -ForegroundColor Green
  Write-Host "  $zipPath"
  Write-Host ("  " + (Join-Path $releaseDir "Install-ISTUDIO.bat"))
  Write-Host ("  " + (Join-Path $releaseDir "Install-ISTUDIO.ps1"))
} finally {
  Pop-Location
}
