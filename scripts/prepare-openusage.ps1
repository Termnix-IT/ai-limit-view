param([switch]$ForceRebuild)
$ErrorActionPreference = 'Stop'
$version = '0.26.3'
$sourceHash = 'E094934421A5E6EBDE9C540BFE8B9DAC4E7B483FD884B0CDE4C88A298DE31313'
$zigHash = '68659EB5F1E4EB1437A722F1DD889C5A322C9954607F5EDCF337BC3684A75A7E'
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$buildRoot = Join-Path $root '.openusage-build'
$destination = Join-Path $root 'src-tauri/binaries/openusage.exe'
$stampPath = Join-Path $buildRoot 'bundle.json'
$patchRoot = Join-Path $PSScriptRoot 'openusage'
# LimitView changes to the pinned source. Each anchor must match exactly once.
#  - export: fail-closed provider filter before Fetch.
#  - claude_code / kimi_cli: skip session log scans that LimitView never displays.
#  - claude_code: do not write the shared statusline cache; results stay in LimitView's memory.
#  - daemon: keep auto-detected accounts in memory instead of rewriting settings.json.
#  - detect: import the OpenCode console cookie only when OpenCode is selected.
$edits = @(
    @{ path = 'internal/export/direct.go'
       original = 'accounts := c.resolveAccts(&cfg)'
       replacement = 'accounts := limitviewProviderAccounts(c.resolveAccts(&cfg))' },
    @{ path = 'internal/providers/claude_code/claude_code.go'
       original = 'if err := p.readConversationJSONL(projectsDir, newProjectsDir, &snap); err != nil {'
       replacement = 'if err := p.limitviewReadConversationJSONL(projectsDir, newProjectsDir, &snap); err != nil {' },
    @{ path = 'internal/providers/claude_code/claude_code.go'
       original = 'WriteFiveHourCache(*m.Used)'
       replacement = 'limitviewWriteFiveHourCache(*m.Used)' },
    @{ path = 'internal/providers/kimi_cli/provider.go'
       original = 'entries, err = readAllSessions(ctx, dir, readKimiConfigModel(resolveConfigPath(acct)))'
       replacement = 'entries, err = limitviewReadAllSessions(ctx, dir, acct)' },
    @{ path = 'internal/daemon/accounts.go'
       original = 'if !sameAutoDetectedAccounts(cfg.AutoDetectedAccounts, autoDetected) {'
       replacement = 'if !limitviewSkipAutoDetectedSave() && !sameAutoDetectedAccounts(cfg.AutoDetectedAccounts, autoDetected) {' },
    @{ path = 'internal/detect/opencode_session.go'
       original = "`topencodeProbeMu.Lock()"
       replacement = "`tif limitviewSkipOpenCodeImport() {`n`t`treturn`n`t}`n`topencodeProbeMu.Lock()" }
)
$overlays = @(
    @{ file = 'limitview_filter.go'; target = 'internal/export' },
    @{ file = 'limitview_filter_test.go'; target = 'internal/export' },
    @{ file = 'limitview_claude.go'; target = 'internal/providers/claude_code' },
    @{ file = 'limitview_claude_test.go'; target = 'internal/providers/claude_code' },
    @{ file = 'limitview_kimi.go'; target = 'internal/providers/kimi_cli' },
    @{ file = 'limitview_kimi_test.go'; target = 'internal/providers/kimi_cli' },
    @{ file = 'limitview_daemon.go'; target = 'internal/daemon' },
    @{ file = 'limitview_daemon_test.go'; target = 'internal/daemon' },
    @{ file = 'limitview_detect.go'; target = 'internal/detect' },
    @{ file = 'limitview_detect_test.go'; target = 'internal/detect' }
)
$testPackages = @('./internal/export', './internal/providers/claude_code', './internal/providers/kimi_cli', './internal/daemon', './internal/detect')
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
function Remove-BuildPath([string]$path) {
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
}
# This script's own edits and every overlay decide whether the bundle is current.
$patchHash = (@((Get-Sha256 $PSCommandPath)) + @($overlays | ForEach-Object { $_.file + ':' + (Get-Sha256 (Join-Path $patchRoot $_.file)) })) -join ';'
if (!$ForceRebuild -and (Test-Path -LiteralPath $destination) -and (Test-Path -LiteralPath $stampPath)) {
    $stamp = Get-Content -Raw -LiteralPath $stampPath | ConvertFrom-Json
    if ($stamp.version -eq $version -and $stamp.sourceHash -eq $sourceHash -and $stamp.zigHash -eq $zigHash -and $stamp.patchHash -eq $patchHash) {
        if ((Get-Sha256 $destination) -ne $stamp.binaryHash) { throw 'Bundled OpenUsage binary has an unexpected checksum.' }
        exit 0
    }
}
if (!(Get-Command go -ErrorAction SilentlyContinue)) { throw 'Go is required to build the provider-filtered OpenUsage bundle.' }
New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null
# Inputs from earlier layouts or versions are never used again.
foreach ($legacy in @('upstream', 'toolchain', 'source.zip')) { Remove-BuildPath (Join-Path $buildRoot $legacy) }
Get-ChildItem -LiteralPath $buildRoot -Filter 'source-*.zip' | Where-Object Name -ne "source-$version.zip" | ForEach-Object { Remove-BuildPath $_.FullName }
# Versioned name so a version bump never reuses an older verified archive.
$sourceArchive = Join-Path $buildRoot "source-$version.zip"
$zigArchive = Join-Path $buildRoot 'zig.zip'
Get-VerifiedArchive "https://codeload.github.com/janekbaraniewski/openusage/zip/refs/tags/v$version" $sourceArchive $sourceHash
Get-VerifiedArchive 'https://ziglang.org/download/0.16.0/zig-x86_64-windows-0.16.0.zip' $zigArchive $zigHash
# Every build starts from freshly extracted, verified archives, so edits left in
# an earlier extraction can never reach the bundle.
$work = Join-Path $buildRoot 'work'
Remove-BuildPath $work
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sourceRoot = Join-Path $work 'upstream'
$source = Join-Path $sourceRoot "openusage-$version"
$zigRoot = Join-Path $work 'toolchain'
$zig = Join-Path $zigRoot 'zig-x86_64-windows-0.16.0/zig.exe'
$previous = @{}
try {
    [System.IO.Compression.ZipFile]::ExtractToDirectory($sourceArchive, $sourceRoot)
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zigArchive, $zigRoot)
    foreach ($edit in $edits) {
        $path = Join-Path $source $edit.path
        $text = [System.IO.File]::ReadAllText($path)
        $count = ([regex]::Matches($text, [regex]::Escape($edit.original))).Count
        if ($count -ne 1) { throw "OpenUsage patch no longer matches the pinned source: $($edit.path)" }
        [System.IO.File]::WriteAllText($path, $text.Replace($edit.original, $edit.replacement))
    }
    foreach ($overlay in $overlays) {
        Copy-Item -LiteralPath (Join-Path $patchRoot $overlay.file) -Destination (Join-Path (Join-Path $source $overlay.target) $overlay.file) -Force
    }
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
    foreach ($name in $buildEnv.Keys) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process'); [Environment]::SetEnvironmentVariable($name, $buildEnv[$name], 'Process') }
    Push-Location $source
    try {
        # The module cache persists between builds; check it against go.sum first.
        & go mod verify
        if ($LASTEXITCODE -ne 0) { throw 'OpenUsage module cache verification failed.' }
        & go test @testPackages -run '^TestLimitView' -count=1
        if ($LASTEXITCODE -ne 0) { throw 'OpenUsage LimitView patch tests failed.' }
        $builtBinary = Join-Path $buildRoot 'openusage-filtered.exe'
        & go build -trimpath -ldflags "-s -w -X github.com/janekbaraniewski/openusage/internal/version.Version=$version-limitview" -o $builtBinary ./cmd/openusage
        if ($LASTEXITCODE -ne 0) { throw 'OpenUsage build failed.' }
        Copy-Item -LiteralPath $builtBinary -Destination $destination -Force
        @{ version = $version; sourceHash = $sourceHash; zigHash = $zigHash; patchHash = $patchHash; binaryHash = (Get-Sha256 $destination) } |
            ConvertTo-Json | Set-Content -LiteralPath $stampPath -Encoding UTF8
    } finally {
        Pop-Location
    }
} finally {
    foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
    Remove-BuildPath $work
}
