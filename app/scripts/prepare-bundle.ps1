# GTBox bundle prep: icons + plugins + workspaces
param(
    [switch]$SkipIcons,
    [switch]$SkipPlugins,
    [switch]$SkipWorkspaces
)

$ErrorActionPreference = "Stop"

$AppRoot = Split-Path $PSScriptRoot -Parent
$RepoRoot = Split-Path $AppRoot -Parent
$ResRoot = Join-Path $AppRoot "src-tauri\resources"
$BundleRoot = Join-Path $ResRoot "bundle"
$PluginsSrc = Join-Path $RepoRoot "plugins"
$WorkspacesSrc = Join-Path $AppRoot "workspaces"
$IconSrc = Join-Path $RepoRoot "box.png"
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

if (-not $SkipIcons) {
    if (-not (Test-Path $IconSrc)) {
        throw "Icon source not found: $IconSrc"
    }
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

$totalMb = [math]::Round(
    (Get-ChildItem $ResRoot -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB,
    1
)
Write-Host ("Resources total: {0} MB" -f $totalMb) -ForegroundColor Green
Write-Host "Next: npm run tauri build" -ForegroundColor Cyan
