# GTBox bundle prep: icons + plugins + workspaces (+ verify public assets for Vite dist)
param(
    [switch]$SkipIcons,
    [switch]$SkipPlugins,
    [switch]$SkipWorkspaces,
    [switch]$SkipVerify
)

$ErrorActionPreference = "Stop"

$AppRoot = Split-Path $PSScriptRoot -Parent
$RepoRoot = Split-Path $AppRoot -Parent
$ResRoot = Join-Path $AppRoot "src-tauri\resources"
$BundleRoot = Join-Path $ResRoot "bundle"
$PluginsSrc = Join-Path $RepoRoot "plugins"
$WorkspacesSrc = Join-Path $AppRoot "workspaces"
$PublicRoot = Join-Path $AppRoot "public"
$IconSrc = Join-Path $RepoRoot "box.png"
$IconsDir = Join-Path $AppRoot "src-tauri\icons"
$ExcludeNames = @(".venv", "__pycache__", ".git", "node_modules", ".pytest_cache", ".mypy_cache")

Write-Host "== GTBox prepare-bundle ==" -ForegroundColor Cyan
Write-Host "App:       $AppRoot"
Write-Host "Repo:      $RepoRoot"
Write-Host "Resources: $ResRoot"

function Copy-TreeFiltered {
    param(
        [string]$Source,
        [string]$Destination
    )

    if (-not (Test-Path $Source)) {
        throw "Source not found: $Source"
    }

    if (Test-Path $Destination) {
        Remove-Item -Recurse -Force $Destination
    }
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null

    Get-ChildItem -Path $Source -Recurse -Force | Where-Object {
        $rel = $_.FullName.Substring($Source.Length).TrimStart("\")
        if ([string]::IsNullOrWhiteSpace($rel)) { return $false }
        foreach ($part in $rel.Split("\")) {
            if ($ExcludeNames -contains $part) { return $false }
        }
        if ($_.Extension -in @(".pyc", ".pyo")) { return $false }
        $true
    } | ForEach-Object {
        $rel = $_.FullName.Substring($Source.Length).TrimStart("\")
        $target = Join-Path $Destination $rel
        if ($_.PSIsContainer) {
            New-Item -ItemType Directory -Path $target -Force | Out-Null
        } else {
            $parent = Split-Path $target -Parent
            if (-not (Test-Path $parent)) {
                New-Item -ItemType Directory -Path $parent -Force | Out-Null
            }
            Copy-Item -Force $_.FullName $target
        }
    }
}

function Assert-PathExists {
    param([string]$Path, [string]$Label)
    if (-not (Test-Path $Path)) {
        throw "Missing $Label`: $Path"
    }
}

function Verify-PublicAssets {
    Write-Host "Verify public assets (bundled via Vite -> dist/)" -ForegroundColor Green

    $checks = @(
        @{ Path = Join-Path $PublicRoot "audio\guitar\builtin\e2.wav"; Label = "guitar builtin e2" },
        @{ Path = Join-Path $PublicRoot "audio\guitar\recorded\e2.wav"; Label = "guitar recorded e2" },
        @{ Path = Join-Path $PublicRoot "gomoku\sounds\bgm.ogg"; Label = "gomoku bgm" },
        @{ Path = Join-Path $PublicRoot "gomoku\sounds\place.wav"; Label = "gomoku place" },
        @{ Path = Join-Path $PublicRoot "gomoku\images\chessboard.png"; Label = "gomoku board" },
        @{ Path = Join-Path $AppRoot "src\assets\themes\galaxy-bg.png"; Label = "galaxy theme bg" }
    )

    foreach ($c in $checks) {
        Assert-PathExists -Path $c.Path -Label $c.Label
    }

    $guitarBuiltin = @(Get-ChildItem (Join-Path $PublicRoot "audio\guitar\builtin\*.wav") -ErrorAction SilentlyContinue).Count
    $skinMp4 = @(Get-ChildItem (Join-Path $WorkspacesSrc "skin-presets\*.mp4") -ErrorAction SilentlyContinue).Count
    $skinBgm = @(Get-ChildItem (Join-Path $WorkspacesSrc "skin-presets\*-bgm.mp3") -ErrorAction SilentlyContinue).Count

    Write-Host ("  public guitar builtin wav: {0}" -f $guitarBuiltin)
    Write-Host ("  workspace skin mp4: {0}, bgm mp3: {1}" -f $skinMp4, $skinBgm)

    if ($guitarBuiltin -lt 6) { throw "Expected at least 6 guitar builtin wav files" }
    if ($skinMp4 -lt 1) { throw "Expected skin-presets mp4 files under workspaces" }
    if ($skinBgm -lt 1) { throw "Expected skin-presets bgm mp3 files under workspaces" }
}

function Assert-AnyPyFile {
    param([string]$DirPath, [string]$Label)
    if (-not (Test-Path $DirPath)) {
        throw "Missing $Label directory: $DirPath"
    }
    $py = @(Get-ChildItem -Path $DirPath -Filter "*.py" -File -ErrorAction SilentlyContinue)
    if ($py.Count -eq 0) {
        throw "Missing python script in $Label`: $DirPath"
    }
}

function Verify-Bundle {
    param([string]$Root)

    Write-Host "Verify bundle resources" -ForegroundColor Green

    $required = @(
        "plugins\batch_rename\manifest.json",
        "plugins\playlist_ocr\region_ocr.py",
        "workspaces\music_crawl\full_auto_download_2t58.py",
        "workspaces\skin-presets\cloud.mp4",
        "workspaces\skin-presets\cloud-bgm.mp3",
        "workspaces\split_pic\main.py"
    )

    foreach ($rel in $required) {
        Assert-PathExists -Path (Join-Path $Root $rel) -Label "bundle/$rel"
    }

    Assert-AnyPyFile -DirPath (Join-Path $Root "workspaces\auto_change_file_name") -Label "batch_rename workspace"

    if (-not (Test-Path (Join-Path $IconsDir "icon.ico"))) {
        throw "Missing app icon: src-tauri/icons/icon.ico (run without -SkipIcons)"
    }
}

if (-not $SkipVerify) {
    Verify-PublicAssets
}

if (-not $SkipIcons) {
    Assert-PathExists -Path $IconSrc -Label "box.png"
    Write-Host "Generate icons from box.png" -ForegroundColor Green
    Push-Location $AppRoot
    try {
        & npm run tauri -- icon $IconSrc
    } finally {
        Pop-Location
    }
} else {
    Write-Host "Skip icons" -ForegroundColor Yellow
}

if (-not $SkipPlugins) {
    Write-Host "Copy plugins -> resources/bundle/plugins" -ForegroundColor Green
    Copy-TreeFiltered -Source $PluginsSrc -Destination (Join-Path $BundleRoot "plugins")
} else {
    Write-Host "Skip plugins" -ForegroundColor Yellow
}

if (-not $SkipWorkspaces) {
    Write-Host "Copy workspaces -> resources/bundle/workspaces" -ForegroundColor Green
    Copy-TreeFiltered -Source $WorkspacesSrc -Destination (Join-Path $BundleRoot "workspaces")
} else {
    Write-Host "Skip workspaces" -ForegroundColor Yellow
}

if (-not $SkipVerify) {
    Verify-Bundle -Root $BundleRoot
}

$totalMb = [math]::Round(
    (Get-ChildItem $ResRoot -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB,
    1
)
Write-Host ("Resources total: {0} MB" -f $totalMb) -ForegroundColor Green
Write-Host "Public audio/gomoku -> npm run build (Vite dist)" -ForegroundColor Cyan
Write-Host "Next: npm run tauri build" -ForegroundColor Cyan
