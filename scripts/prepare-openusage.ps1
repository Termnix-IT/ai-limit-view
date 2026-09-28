$ErrorActionPreference = 'Stop'

$version = '0.25.0'
$binaryHash = '4743475130FA7588D0259149A769E4BB25A07EE48C11F058C84D9E2B1D99E922'
$archiveHash = '017D3CC33FF21A1E65A417FFCDC3C39E2034EE3282FDC2B7E636894DFEEF205F'
$destination = Join-Path $PSScriptRoot '..\src-tauri\binaries\openusage.exe'
$local = Join-Path $PSScriptRoot '..\..\..\Service\LLMDashboard\.local-tools\openusage\openusage.exe'

function Get-Sha256([string]$path) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $path).Path)
        return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '')
    } finally {
        $sha.Dispose()
    }
}

New-Item -ItemType Directory -Force -Path (Split-Path $destination) | Out-Null
if (Test-Path $destination) {
    if ((Get-Sha256 $destination) -eq $binaryHash) { exit 0 }
    throw 'Bundled OpenUsage binary has an unexpected checksum.'
}

if ((Test-Path $local) -and ((Get-Sha256 $local) -eq $binaryHash)) {
    Copy-Item -LiteralPath $local -Destination $destination
    exit 0
}

$archive = Join-Path $env:TEMP "openusage_${version}_windows_amd64.zip"
$url = "https://github.com/janekbaraniewski/openusage/releases/download/v$version/openusage_${version}_windows_amd64.zip"
Invoke-WebRequest -Uri $url -OutFile $archive
if ((Get-Sha256 $archive) -ne $archiveHash) {
    throw 'Downloaded OpenUsage archive has an unexpected checksum.'
}
$unpacked = Join-Path $env:TEMP "limitview-openusage-$version"
New-Item -ItemType Directory -Force -Path $unpacked | Out-Null
Expand-Archive -LiteralPath $archive -DestinationPath $unpacked -Force
$binary = Join-Path $unpacked 'openusage.exe'
if ((Get-Sha256 $binary) -ne $binaryHash) {
    throw 'Downloaded OpenUsage binary has an unexpected checksum.'
}
Copy-Item -LiteralPath $binary -Destination $destination
