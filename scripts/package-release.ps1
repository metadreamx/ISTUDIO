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
    [string]$Repo
  )

  $content = Get-Content -LiteralPath $Source -Raw
  if (-not [string]::IsNullOrWhiteSpace($Repo)) {
    $content = $content.Replace("YOUR_GITHUB_USERNAME/ISTUDIO", $Repo)
    $content = $content.Replace("metadreamx/ISTUDIO", $Repo)
  }
  Set-Content -LiteralPath $Destination -Value $content -Encoding ascii
}

function Find-CSharpCompiler {
  $candidates = @(
    (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
    (Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe")
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  $command = Get-Command csc.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  throw "Could not find csc.exe to build ISTUDIO.exe."
}

function Build-ExeLauncher {
  param(
    [string]$Source,
    [string]$Output
  )

  $compiler = Find-CSharpCompiler
  if (Test-Path $Output) {
    Remove-Item -LiteralPath $Output -Force
  }

  & $compiler /nologo /target:exe /platform:anycpu "/out:$Output" $Source
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to build ISTUDIO.exe."
  }
  if (-not (Test-Path $Output) -or (Get-Item $Output).Length -le 0) {
    throw "ISTUDIO.exe was not created correctly."
  }
}

function Assert-ReleasePackage {
  param(
    [string]$PackageRoot,
    [bool]$RequirePortableNode
  )

  $requiredPaths = @(
    "ISTUDIO.bat",
    "ISTUDIO.exe",
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
$exePath = Join-Path $releaseDir "ISTUDIO.exe"
$batPath = Join-Path $releaseDir "ISTUDIO.bat"

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
  Build-ExeLauncher -Source (Join-Path $root "launcher\ISTUDIO.cs") -Output $exePath

  $items = @(
    ".env.example",
    "ISTUDIO.bat",
    "package.json",
    "package-lock.json",
    "README.md",
    "dist",
    "dist-server",
    "scripts\ISTUDIO-Launcher.ps1",
    "node_modules"
  )

  foreach ($item in $items) {
    Copy-RequiredItem -Name $item -Root $root -Destination $appStage
  }
  Copy-Item -LiteralPath $exePath -Destination $appStage -Force

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

  Write-ReleaseInstaller -Source (Join-Path $root "ISTUDIO.bat") -Destination $batPath -Repo $Repo
  Remove-Item -LiteralPath (Join-Path $releaseDir "Install-ISTUDIO.bat") -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $releaseDir "Install-ISTUDIO.ps1") -Force -ErrorAction SilentlyContinue

  Write-Host ""
  Write-Host "Release package created:" -ForegroundColor Green
  Write-Host "  $zipPath"
  Write-Host ("  " + $batPath)
  Write-Host ("  " + $exePath)
} finally {
  Pop-Location
}
