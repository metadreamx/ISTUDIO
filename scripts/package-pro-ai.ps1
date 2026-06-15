[CmdletBinding()]
param(
  [string]$OutputZip = "",
  [switch]$SkipExisting
)

$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$releaseDir = Join-Path $root "release"
$stageRoot = Join-Path $releaseDir "pro-ai-stage"
$packRoot = Join-Path $stageRoot "ISTUDIO-ProTools"
$modelsDir = Join-Path $packRoot "models\pro-ai"
$runtimeDir = Join-Path $packRoot "runtime\pro-ai"

if ([string]::IsNullOrWhiteSpace($OutputZip)) {
  $OutputZip = Join-Path $releaseDir "ISTUDIO-ProTools-windows.zip"
}

$models = @(
  @{
    id = "isnet-general-use"
    task = "segmentation"
    file = "isnet-general-use.onnx"
    inputSize = 1024
    url = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx"
  },
  @{
    id = "u2net"
    task = "segmentation"
    file = "u2net.onnx"
    inputSize = 320
    url = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx"
  },
  @{
    id = "u2net-human"
    task = "segmentation"
    file = "u2net_human_seg.onnx"
    inputSize = 320
    url = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_human_seg.onnx"
  },
  @{
    id = "u2netp-fast"
    task = "segmentation"
    file = "u2netp.onnx"
    inputSize = 320
    url = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx"
  }
)

if (Test-Path $stageRoot) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $modelsDir, $runtimeDir, $releaseDir | Out-Null

$downloadCache = Join-Path $releaseDir "pro-ai-downloads"
New-Item -ItemType Directory -Force -Path $downloadCache | Out-Null

foreach ($model in $models) {
  $cachePath = Join-Path $downloadCache $model.file
  $targetPath = Join-Path $modelsDir $model.file
  if (-not (Test-Path $cachePath) -or -not $SkipExisting) {
    Write-Host "Downloading Pro AI model $($model.id)..."
    Invoke-WebRequest -Uri $model.url -OutFile $cachePath
  }
  Copy-Item -LiteralPath $cachePath -Destination $targetPath -Force
}

$manifest = [ordered]@{
  version = 1
  createdAt = (Get-Date).ToString("o")
  runtime = "onnxruntime-node"
  models = $models | ForEach-Object {
    [ordered]@{
      id = $_.id
      task = $_.task
      file = $_.file
      inputSize = $_.inputSize
      channels = "rgb"
    }
  }
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $modelsDir "manifest.json") -Encoding utf8

$notice = @"
ISTUDIO Pro AI Pack

Included models are used locally for background removal and matte generation.
Primary model source: danielgatis/rembg release assets.
U2Net and ISNet model families are open models commonly distributed for rembg-compatible local background removal workflows.

No images are uploaded by this pack. Processing runs through ISTUDIO's local ONNX runtime.
"@
$notice | Set-Content -LiteralPath (Join-Path $packRoot "PRO-AI-NOTICE.txt") -Encoding utf8

if (Test-Path $OutputZip) {
  Remove-Item -LiteralPath $OutputZip -Force
}

Push-Location $stageRoot
try {
  tar.exe -a -cf $OutputZip "ISTUDIO-ProTools"
  if ($LASTEXITCODE -ne 0) {
    throw "tar.exe failed with exit code $LASTEXITCODE"
  }
} catch {
  Write-Warning "tar.exe could not create the Pro AI zip package. Falling back to Compress-Archive."
  Compress-Archive -Path $packRoot -DestinationPath $OutputZip -Force
} finally {
  Pop-Location
}

if (-not (Test-Path $OutputZip) -or (Get-Item $OutputZip).Length -le 0) {
  throw "Pro AI Pack zip was not created correctly."
}

Write-Host "Pro AI Pack created:" -ForegroundColor Green
Write-Host ("  " + $OutputZip)
