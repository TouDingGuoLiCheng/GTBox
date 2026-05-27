# SR bundle prep: embedded Python + ONNX model + streaming_asr.py
param(
    [switch]$SkipPython,
    [switch]$SkipModel
)

$ErrorActionPreference = "Stop"

$SrRoot = Split-Path $PSScriptRoot -Parent
$RepoRoot = Resolve-Path (Join-Path $SrRoot "..")
$ModelsSrc = Join-Path $RepoRoot "workspaces\sr_asr\models"
$ResRoot = Join-Path $SrRoot "src-tauri\resources"
$ModelsDst = Join-Path $ResRoot "models"
$ScriptSrc = Join-Path $RepoRoot "workspaces\sr_asr\streaming_asr.py"
$ScriptDst = Join-Path $ResRoot "streaming_asr.py"

Write-Host "== SR prepare-bundle ==" -ForegroundColor Cyan
Write-Host "SR:        $SrRoot"
Write-Host "Resources: $ResRoot"

if (-not $SkipPython) {
    & (Join-Path $PSScriptRoot "prepare-python.ps1") -ResRoot $ResRoot -RepoRoot $RepoRoot
} else {
    Write-Host "Skip Python (prepare:bundle:fast)" -ForegroundColor Yellow
}

if (-not $SkipModel) {
    if (-not (Test-Path $ModelsSrc)) {
        throw "Model source not found: $ModelsSrc`nRun: cd workspaces\sr_asr; .\download_model.ps1"
    }

    $modelDirs = Get-ChildItem -Path $ModelsSrc -Directory | Where-Object {
        Test-Path (Join-Path $_.FullName "tokens.txt")
    }
    if ($modelDirs.Count -eq 0) {
        throw "No model with tokens.txt under models/. Run download_model.ps1 first."
    }

    $src = $modelDirs[0].FullName
    $name = $modelDirs[0].Name
    $dst = Join-Path $ModelsDst $name

    Write-Host "Copy model: $name" -ForegroundColor Green

    if (Test-Path $ModelsDst) {
        Remove-Item -Recurse -Force $ModelsDst
    }
    New-Item -ItemType Directory -Path $dst -Force | Out-Null

    $exclude = @("test_wavs", ".git")
    Get-ChildItem -Path $src -Recurse | Where-Object {
        $rel = $_.FullName.Substring($src.Length).TrimStart("\")
        $skip = $false
        foreach ($e in $exclude) {
            if ($rel -like "$e*" -or $rel -like "*\$e\*") { $skip = $true; break }
        }
        -not $skip
    } | ForEach-Object {
        $rel = $_.FullName.Substring($src.Length).TrimStart("\")
        $target = Join-Path $dst $rel
        if ($_.PSIsContainer) {
            New-Item -ItemType Directory -Path $target -Force | Out-Null
        } else {
            $parent = Split-Path $target -Parent
            if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
            Copy-Item -Force $_.FullName $target
        }
    }

    if (-not (Test-Path (Join-Path $dst "tokens.txt"))) {
        throw "tokens.txt missing after copy"
    }

    $sizeMb = [math]::Round((Get-ChildItem $ModelsDst -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB, 1)
    Write-Host ("Model ready: {0} MB" -f $sizeMb) -ForegroundColor Green
}

if (Test-Path $ScriptSrc) {
    Copy-Item -Force $ScriptSrc $ScriptDst
    Write-Host "Synced streaming_asr.py"
} elseif (-not (Test-Path $ScriptDst)) {
    throw "Missing streaming_asr.py"
}

$totalMb = [math]::Round((Get-ChildItem $ResRoot -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB, 1)
Write-Host ("Resources total: {0} MB" -f $totalMb) -ForegroundColor Green
Write-Host "Next: npm run tauri build" -ForegroundColor Cyan
