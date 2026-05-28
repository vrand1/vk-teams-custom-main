# Launch VK WorkSpace in Chrome/Edge "app" window with this extension loaded.
# Use this instead of the official desktop client when you need custom reactions.
#
# Usage:
#   .\launch-workspace-app.ps1
#   .\launch-workspace-app.ps1 -Url "https://myteam.mail.ru/webim/"
#   .\launch-workspace-app.ps1 -Browser edge

param(
    [string]$Url = "https://myteam.mail.ru/webim/",
    [ValidateSet("auto", "chrome", "edge")]
    [string]$Browser = "auto",
    # Use main Chrome/Edge profile (extension must be installed + activated once in chrome://extensions)
    [switch]$SharedProfile
)

$ErrorActionPreference = "Stop"

$ExtensionRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ProfileDir = Join-Path $env:LOCALAPPDATA "VKTeamsCustomReactions\BrowserProfile"

if (-not (Test-Path (Join-Path $ExtensionRoot "manifest.json"))) {
    Write-Error "manifest.json not found in $ExtensionRoot"
}

function Find-BrowserExe {
    param([string]$Name)

    $candidates = @()
    if ($Name -eq "chrome") {
        $candidates = @(
            "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
            "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
            "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
        )
    }
    if ($Name -eq "edge") {
        $candidates = @(
            "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe",
            "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
        )
    }

    foreach ($path in $candidates) {
        if ($path -and (Test-Path $path)) {
            return $path
        }
    }
    return $null
}

$exe = $null
if ($Browser -eq "chrome") {
    $exe = Find-BrowserExe "chrome"
}
elseif ($Browser -eq "edge") {
    $exe = Find-BrowserExe "edge"
}
else {
    $exe = Find-BrowserExe "chrome"
    if (-not $exe) {
        $exe = Find-BrowserExe "edge"
    }
}

if (-not $exe) {
    Write-Error "Chrome or Edge not found. Install a Chromium browser or pass -Browser chrome|edge."
}

$args = @(
    "--app=$Url",
    "--no-first-run",
    "--disable-features=ChromeWhatsNewUI"
)

if ($SharedProfile) {
    Write-Host "Mode:     SharedProfile (extension from your normal Chrome install)"
    Write-Host "          Install once: chrome://extensions -> Load unpacked -> repo folder"
    Write-Host "          Then Activate in extension popup."
}
else {
    New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
    $args = @(
        "--load-extension=$ExtensionRoot",
        "--user-data-dir=$ProfileDir"
    ) + $args
    Write-Host "Mode:     Isolated profile (first run: click extension icon -> Activate)"
    Write-Host "Profile:  $ProfileDir"
}

Write-Host "Browser:  $exe"
Write-Host "Extension:$ExtensionRoot"
Write-Host "URL:      $Url"
Write-Host ""
Write-Host "Tip: for Electron desktop fork run: cd electron-shell && npm install && npm start"
Write-Host ""
Write-Host "Opening VK WorkSpace (desktop-like window)..."

Start-Process -FilePath $exe -ArgumentList $args
