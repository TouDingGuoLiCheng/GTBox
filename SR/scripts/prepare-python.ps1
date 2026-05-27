# Embedded Python venv for installer (sherpa-onnx + numpy)
param(
    [string]$ResRoot = (Join-Path (Split-Path $PSScriptRoot -Parent) "src-tauri\resources"),
    [string]$RepoRoot = (Resolve-Path (Join-Path (Split-Path $PSScriptRoot -Parent) ".."))
)

$ErrorActionPreference = "Stop"

$PyDir = Join-Path $ResRoot "python"
$ReqFile = Join-Path $RepoRoot "workspaces\sr_asr\requirements.txt"

Write-Host "== SR prepare-python ==" -ForegroundColor Cyan
Write-Host "Target: $PyDir"

if (-not (Test-Path $ReqFile)) {
    throw "Missing $ReqFile"
}

function Find-SystemPython {
    foreach ($cmd in @("python", "py")) {
        $c = Get-Command $cmd -ErrorAction SilentlyContinue
        if ($c) { return $c.Source }
    }
    return $null
}

$sysPython = Find-SystemPython
if (-not $sysPython) {
    throw "python/py not found. Install Python 3.10+ on build machine."
}

Write-Host "Host Python: $sysPython"

if (Test-Path $PyDir) {
    Write-Host "Removing old python folder..."
    Remove-Item -Recurse -Force $PyDir
}

Write-Host "Creating venv (--copies)..."
if ($sysPython -match "py\.exe$") {
    & $sysPython -3 -m venv $PyDir --copies
} else {
    & $sysPython -m venv $PyDir --copies
}

$PyExe = Join-Path $PyDir "Scripts\python.exe"
$PipExe = Join-Path $PyDir "Scripts\pip.exe"

if (-not (Test-Path $PyExe)) {
    throw "venv failed: $PyExe"
}

Write-Host "Upgrading pip..."
& $PyExe -m pip install --upgrade pip wheel --quiet

Write-Host "Installing sherpa-onnx / numpy (may take several minutes)..."
& $PipExe install --no-cache-dir -r $ReqFile

Write-Host "Verify imports..."
& $PyExe -c "import numpy; import sherpa_onnx; print('ok')"

function Get-PyvenvBaseHome {
    param([string]$VenvRoot)
    $cfgPath = Join-Path $VenvRoot "pyvenv.cfg"
  foreach ($line in Get-Content $cfgPath) {
        if ($line -match '^\s*home\s*=\s*(.+)\s*$') {
            return $Matches[1].Trim()
        }
    }
    throw "pyvenv.cfg missing home: $cfgPath"
}

function Install-PortableRuntimeFiles {
    param(
        [string]$VenvRoot,
        [string]$BaseHome
    )
    Write-Host "Copy portable runtime into venv root (for bundled install)..." -ForegroundColor DarkGray
    foreach ($name in @(
            "python.exe", "pythonw.exe", "python3.dll", "python311.dll",
            "python312.dll", "python313.dll",
            "vcruntime140.dll", "vcruntime140_1.dll", "python311.zip", "python312.zip", "python313.zip"
        )) {
        $src = Join-Path $BaseHome $name
        $dst = Join-Path $VenvRoot $name
        if ((Test-Path $src) -and -not (Test-Path $dst)) {
            Copy-Item $src $dst -Force
        }
    }
    $rootPy = Join-Path $VenvRoot "python.exe"
    if (-not (Test-Path $rootPy)) {
        throw "Portable runtime incomplete: missing $rootPy"
    }

    $zipCount = @(Get-ChildItem -Path $VenvRoot -Filter "python3*.zip" -File -ErrorAction SilentlyContinue).Count
    if ($zipCount -eq 0) {
        $srcLib = Join-Path $BaseHome "Lib"
        $dstLib = Join-Path $VenvRoot "Lib"
        if (-not (Test-Path $srcLib)) {
            throw "Portable runtime incomplete: neither python3*.zip nor Lib found under $BaseHome"
        }
        Write-Host "python3*.zip not found, copying stdlib Lib/ fallback..." -ForegroundColor DarkGray
        Get-ChildItem -Path $srcLib | Where-Object { $_.Name -ne "site-packages" } | ForEach-Object {
            Copy-Item -Path $_.FullName -Destination $dstLib -Recurse -Force
        }
    }
}

function Update-PyvenvCfg {
    param([string]$VenvRoot)
    $resolved = (Resolve-Path $VenvRoot).Path
    $exe = Join-Path $resolved "Scripts\python.exe"
    $cfgPath = Join-Path $VenvRoot "pyvenv.cfg"
    $newLines = @(
        "home = $resolved",
        "include-system-site-packages = false"
    )
    foreach ($line in Get-Content $cfgPath) {
        if ($line -match '^\s*version\s*=') { $newLines += $line.TrimEnd() }
    }
    $newLines += "executable = $exe"
    Set-Content -Path $cfgPath -Value ($newLines -join "`n") -Encoding ascii
    Write-Host "Patched pyvenv.cfg home -> $resolved" -ForegroundColor DarkGray
}

$baseHome = Get-PyvenvBaseHome -VenvRoot $PyDir
Install-PortableRuntimeFiles -VenvRoot $PyDir -BaseHome $baseHome
Update-PyvenvCfg -VenvRoot $PyDir
& $PyExe -c "import numpy, sherpa_onnx; print('portable ok')"

function Slim-PythonVenv {
    param([string]$Root)
    Write-Host "Slim venv (remove pip, tests, cache)..." -ForegroundColor DarkGray
    $sp = Join-Path $Root "Lib\site-packages"
    foreach ($name in @("pip", "pip-*", "setuptools", "setuptools-*", "wheel", "wheel-*", "pkg_resources")) {
        Get-ChildItem -Path $sp -Filter $name -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }
    foreach ($name in @("pip.exe", "pip3.exe", "pip3.*.exe")) {
        Remove-Item (Join-Path $Root "Scripts\$name") -Force -ErrorAction SilentlyContinue
    }
    Get-ChildItem -Path $Root -Recurse -Directory -Filter "__pycache__" -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Get-ChildItem -Path $Root -Recurse -Include "*.pyc", "*.pyo" -File -ErrorAction SilentlyContinue |
        Remove-Item -Force -ErrorAction SilentlyContinue
    Get-ChildItem -Path $sp -Recurse -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -in @("tests", "test", "testing", "docs", "doc") } |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

function Show-SizeBreakdown {
    param([string]$Root)
    Write-Host ""
    Write-Host "Size breakdown (top packages):" -ForegroundColor Cyan
    $sp = Join-Path $Root "Lib\site-packages"
    $items = @()
    if (Test-Path $sp) {
        Get-ChildItem $sp -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $mb = (Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue |
                Measure-Object -Property Length -Sum).Sum / 1MB
            if ($mb -gt 0.5) { $items += [PSCustomObject]@{ Name = $_.Name; MB = [math]::Round($mb, 1) } }
        }
    }
    $pyLib = Join-Path $Root "Lib"
    if (Test-Path $pyLib) {
        $stdlibMb = (Get-ChildItem $pyLib -File -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notlike "*\site-packages\*" } |
            Measure-Object -Property Length -Sum).Sum / 1MB
        if ($stdlibMb -gt 1) {
            $items += [PSCustomObject]@{ Name = "python-stdlib"; MB = [math]::Round($stdlibMb, 1) }
        }
    }
    $items | Sort-Object MB -Descending | Select-Object -First 8 | Format-Table -AutoSize
}

Slim-PythonVenv -Root $PyDir
& $PyExe -c "import numpy, sherpa_onnx"

Show-SizeBreakdown -Root $PyDir

$sizeMb = [math]::Round((Get-ChildItem $PyDir -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB, 1)
Write-Host ("Embedded Python ready: {0} ({1} MB)" -f $PyDir, $sizeMb) -ForegroundColor Green
