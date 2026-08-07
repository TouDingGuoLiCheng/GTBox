# Ensure bundle exists before tauri build; auto-run prepare if incomplete
$ErrorActionPreference = "Stop"

$AppRoot = Split-Path $PSScriptRoot -Parent
$BundleRoot = Join-Path $AppRoot "src-tauri\resources\bundle"
$IconsIco = Join-Path $AppRoot "src-tauri\icons\icon.ico"
$PrepareScript = Join-Path $PSScriptRoot "prepare-bundle.ps1"

$required = @(
    "plugins\batch_rename\manifest.json",
    "plugins\mc_mod_updater\manifest.json",
    "plugins\playlist_ocr\region_ocr.py",
    "workspaces\music_crawl\full_auto_download_2t58.py",
    "workspaces\mc_mod_updater\mod_updater.py",
    "workspaces\skin-presets\cloud.mp4",
    "workspaces\skin-presets\cloud-bgm.mp3"
)

$missing = @()
foreach ($rel in $required) {
    if (-not (Test-Path (Join-Path $BundleRoot $rel))) {
        $missing += $rel
    }
}

$batchRenameDir = Join-Path $BundleRoot "workspaces\auto_change_file_name"
if (-not (Test-Path $batchRenameDir) -or @(Get-ChildItem $batchRenameDir -Filter "*.py" -File -ErrorAction SilentlyContinue).Count -eq 0) {
    $missing += "workspaces\auto_change_file_name\*.py"
}

$iconsMissing = -not (Test-Path $IconsIco)

if ($missing.Count -eq 0 -and -not $iconsMissing) {
    Write-Host "GTBox bundle OK" -ForegroundColor Green
    exit 0
}

Write-Host "GTBox bundle incomplete (missing files: $($missing.Count), icons missing: $iconsMissing)" -ForegroundColor Yellow
if ($iconsMissing) {
    & $PrepareScript
} else {
    & $PrepareScript -SkipIcons
}
