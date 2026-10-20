param([switch]$ForceRebuild)
$ErrorActionPreference = 'Stop'
$version = '0.26.1'
$sourceHash = '0BBD11DCEDF65A972090BE958FBFB814C1F44EFC0D6A67266A92EA5DADD50CE5'
$zigHash = '68659EB5F1E4EB1437A722F1DD889C5A322C9954607F5EDCF337BC3684A75A7E'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$buildRoot = Join-Path $root '.openusage-build'
$destination = Join-Path $root 'src-tauri/binaries/openusage.exe'
$stampPath = Join-Path $buildRoot 'bundle.json'
$patchRoot = Join-Path $PSScriptRoot 'openusage'
function Get-Sha256([string]$path) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead([System.IO.Path]::GetFullPath($path))
    try { return ([System.BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '') }
    finally { $stream.Dispose(); $sha.Dispose() }
}
function Get-VerifiedArchive([string]$url, [string]$path, [string]$hash) {
    if (!(Test-Path -LiteralPath $path)) { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $path }
    if ((Get-Sha256 $path) -ne $hash) { throw 'Downloaded OpenUsage build input has an unexpected checksum.' }
}
$filterHash = Get-Sha256 (Join-Path $patchRoot 'limitview_filter.go')
$testHash = Get-Sha256 (Join-Path $patchRoot 'limitview_filter_test.go')
if (!$ForceRebuild -and (Test-Path -LiteralPath $destination) -and (Test-Path -LiteralPath $stampPath)) {
    $stamp = Get-Content -Raw -LiteralPath $stampPath | ConvertFrom-Json
    if ($stamp.version -eq $version -and $stamp.sourceHash -eq $sourceHash -and $stamp.filterHash -eq $filterHash -and $stamp.testHash -eq $testHash) {
        if ((Get-Sha256 $destination) -ne $stamp.binaryHash) { throw 'Bundled OpenUsage binary has an unexpected checksum.' }
        exit 0
    }
}
if (!(Get-Command go -ErrorAction SilentlyContinue)) { throw 'Go is required to build the provider-filtered OpenUsage bundle.' }
New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null
$sourceArchive = Join-Path $buildRoot 'source.zip'
$zigArchive = Join-Path $buildRoot 'zig.zip'
Get-VerifiedArchive "https://codeload.github.com/janekbaraniewski/openusage/zip/refs/tags/v$version" $sourceArchive $sourceHash
Get-VerifiedArchive 'https://ziglang.org/download/0.16.0/zig-x86_64-windows-0.16.0.zip' $zigArchive $zigHash
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sourceRoot = Join-Path $buildRoot 'upstream'
$source = Join-Path $sourceRoot "openusage-$version"
if (!(Test-Path -LiteralPath (Join-Path $source 'go.mod'))) { [System.IO.Compression.ZipFile]::ExtractToDirectory($sourceArchive, $sourceRoot) }
$zigRoot = Join-Path $buildRoot 'toolchain'
$zig = Join-Path $zigRoot 'zig-x86_64-windows-0.16.0/zig.exe'
if (!(Test-Path -LiteralPath $zig)) { [System.IO.Compression.ZipFile]::ExtractToDirectory($zigArchive, $zigRoot) }
# The only upstream behavior change is a fail-closed filter before provider Fetch.
$directPath = Join-Path $source 'internal/export/direct.go'
$direct = [System.IO.File]::ReadAllText($directPath)
$original = 'accounts := c.resolveAccts(&cfg)'
$replacement = 'accounts := limitviewProviderAccounts(c.resolveAccts(&cfg))'
if ($direct.Contains($original)) { $direct = $direct.Replace($original, $replacement) }
elseif (!$direct.Contains($replacement)) { throw 'OpenUsage provider filter patch no longer matches the pinned source.' }
[System.IO.File]::WriteAllText($directPath, $direct)
Copy-Item -LiteralPath (Join-Path $patchRoot 'limitview_filter.go') -Destination (Join-Path $source 'internal/export/limitview_filter.go') -Force
Copy-Item -LiteralPath (Join-Path $patchRoot 'limitview_filter_test.go') -Destination (Join-Path $source 'internal/export/limitview_filter_test.go') -Force
# Compiler and caches stay inside the checkout; no system installation.
$compilerTemp = Join-Path $buildRoot 'tmp'
New-Item -ItemType Directory -Force -Path $compilerTemp | Out-Null
$buildEnv = @{
    CGO_ENABLED = '1'; CC = ('"' + $zig + '" cc -target x86_64-windows-gnu');
    GOCACHE = (Join-Path $buildRoot 'go-cache'); GOMODCACHE = (Join-Path $buildRoot 'go-mod');
    GOPATH = (Join-Path $buildRoot 'go-path');
    ZIG_GLOBAL_CACHE_DIR = (Join-Path $buildRoot 'zig-cache');
    GOTMPDIR = $compilerTemp; TEMP = $compilerTemp; TMP = $compilerTemp;
}
$previous = @{}
foreach ($name in $buildEnv.Keys) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process'); [Environment]::SetEnvironmentVariable($name, $buildEnv[$name], 'Process') }
Push-Location $source
try {
    & go test ./internal/export -run '^TestLimitViewProviderFilter$' -count=1
    if ($LASTEXITCODE -ne 0) { throw 'OpenUsage provider-filter tests failed.' }
    $builtBinary = Join-Path $buildRoot 'openusage-filtered.exe'
    & go build -trimpath -ldflags "-s -w -X github.com/janekbaraniewski/openusage/internal/version.Version=$version-limitview" -o $builtBinary ./cmd/openusage
    if ($LASTEXITCODE -ne 0) { throw 'OpenUsage build failed.' }
    Copy-Item -LiteralPath $builtBinary -Destination $destination -Force
    @{ version = $version; sourceHash = $sourceHash; filterHash = $filterHash; testHash = $testHash; binaryHash = (Get-Sha256 $destination) } |
        ConvertTo-Json | Set-Content -LiteralPath $stampPath -Encoding UTF8
} finally {
    Pop-Location
    foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
