# Dupo installer for Windows.
# Usage: irm https://getdupo.vercel.app/install.ps1 | iex
$ErrorActionPreference = "Stop"

$Repo = "zetahiveco/dupo"
$App = "dupo"

Write-Host "Installing Dupo..."

# Windows on ARM is not yet built; assume x86_64.
$Target = "windows-x86_64"

try {
  $Latest = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest"
  $Version = $Latest.tag_name
} catch {
  Write-Error "Could not determine the latest release. Download manually from https://github.com/$Repo/releases"
  exit 1
}

$Asset = "$App-$Target.zip"
$Url = "https://github.com/$Repo/releases/download/$Version/$Asset"
$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("dupo-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $Tmp | Out-Null

Write-Host "Downloading $Asset ($Version)..."
$Zip = Join-Path $Tmp $Asset
Invoke-WebRequest -Uri $Url -OutFile $Zip

Expand-Archive -Path $Zip -DestinationPath $Tmp -Force

$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\dupo"
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Copy-Item (Join-Path $Tmp "$App.exe") -Destination $InstallDir -Force

# Add to the user PATH if not present.
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$InstallDir*") {
  [Environment]::SetEnvironmentVariable("Path", "$UserPath;$InstallDir", "User")
  Write-Host "Added $InstallDir to your PATH. Restart your terminal for it to apply."
}

Remove-Item -Recurse -Force $Tmp
Write-Host "Installed Dupo $Version to $InstallDir."
Write-Host "Run 'dupo' to start designing."
