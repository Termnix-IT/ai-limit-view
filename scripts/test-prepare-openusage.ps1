$ErrorActionPreference = 'Stop'
# Isolated fixtures exercise verified build inputs, patching, caching and failed builds.
$fixtureRoot = Join-Path $env:TEMP ("limitview-openusage-test-" + [guid]::NewGuid().ToString('N'))
$scripts = Join-Path $fixtureRoot 'scripts'
$buildRoot = Join-Path $fixtureRoot '.openusage-build'
$version = [regex]::Match([System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'prepare-openusage.ps1')), '(?m)^\$version = ''([^'']+)''').Groups[1].Value
$upstream = Join-Path $fixtureRoot "fixtures/openusage-$version"
$zigFixture = Join-Path $fixtureRoot 'fixtures/zig-x86_64-windows-0.16.0'
# Anchor lines from the pinned source, keyed by file, with the text each patch must produce.
$anchors = [ordered]@{
    'internal/export/direct.go' = @('accounts := c.resolveAccts(&cfg)', 'limitviewProviderAccounts(c.resolveAccts(&cfg))')
    'internal/providers/claude_code/claude_code.go' = @('if err := p.readConversationJSONL(projectsDir, newProjectsDir, &snap); err != nil {', 'p.limitviewReadConversationJSONL(')
    'internal/providers/kimi_cli/provider.go' = @('entries, err = readAllSessions(ctx, dir, readKimiConfigModel(resolveConfigPath(acct)))', 'limitviewReadAllSessions(ctx, dir, acct)')
    'internal/daemon/accounts.go' = @('if !sameAutoDetectedAccounts(cfg.AutoDetectedAccounts, autoDetected) {', '!limitviewSkipAutoDetectedSave() && ')
    'internal/detect/opencode_session.go' = @("func detect() {`n`topencodeProbeMu.Lock()`n}", "if limitviewSkipOpenCodeImport() {")
}
New-Item -ItemType Directory -Force -Path $scripts, $buildRoot, (Join-Path $scripts 'openusage'), $upstream, $zigFixture, (Join-Path $fixtureRoot 'src-tauri/binaries') | Out-Null
[System.IO.File]::WriteAllText((Join-Path $upstream 'go.mod'), 'module fixture')
foreach ($file in $anchors.Keys) {
    $path = Join-Path $upstream $file
    New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
    [System.IO.File]::WriteAllText($path, $anchors[$file][0])
}
[System.IO.File]::WriteAllText((Join-Path $zigFixture 'zig.exe'), 'fixture compiler')
$sourceZip = Join-Path $fixtureRoot 'source-fixture.zip'
$zigZip = Join-Path $fixtureRoot 'zig-fixture.zip'
Compress-Archive -LiteralPath $upstream -DestinationPath $sourceZip
Compress-Archive -LiteralPath $zigFixture -DestinationPath $zigZip
$sourceHash = (Get-FileHash -LiteralPath $sourceZip -Algorithm SHA256).Hash
$zigHash = (Get-FileHash -LiteralPath $zigZip -Algorithm SHA256).Hash
$source = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'prepare-openusage.ps1'))
$source = [regex]::Replace($source, '(?m)^\$sourceHash = ''[A-F0-9]{64}''', ('$$sourceHash = ''' + $sourceHash + ''''))
$source = [regex]::Replace($source, '(?m)^\$zigHash = ''[A-F0-9]{64}''', ('$$zigHash = ''' + $zigHash + ''''))
$scriptPath = Join-Path $scripts 'prepare-openusage.ps1'
[System.IO.File]::WriteAllText($scriptPath, $source)
Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'openusage') -Filter '*.go' | Copy-Item -Destination (Join-Path $scripts 'openusage')
$fixtureCounters = @{ downloads = 0; verifies = 0; tests = 0; builds = 0; failBuild = $false }
function Invoke-WebRequest([string]$Uri, [string]$OutFile, [switch]$UseBasicParsing) {
    $fixtureCounters.downloads++
    Copy-Item -LiteralPath $(if ($Uri -like '*ziglang.org*') { $zigZip } else { $sourceZip }) -Destination $OutFile
}
function go {
    $arguments = $args
    if ($arguments[0] -eq 'mod') {
        $fixtureCounters.verifies++
    } elseif ($arguments[0] -eq 'test') {
        $fixtureCounters.tests++
        foreach ($file in $anchors.Keys) {
            $text = [System.IO.File]::ReadAllText((Join-Path (Get-Location) $file))
            if (!$text.Contains($anchors[$file][1])) { throw "Patch must be installed before tests: $file" }
            if ($text.Contains('tampered')) { throw "Stale extraction reached the build: $file" }
        }
        foreach ($overlay in Get-ChildItem -LiteralPath (Join-Path $scripts 'openusage') -Filter '*.go') {
            if (!(Get-ChildItem -Path (Get-Location) -Recurse -Filter $overlay.Name)) { throw "Overlay must be installed before tests: $($overlay.Name)" }
        }
    } else {
        $fixtureCounters.builds++
        if ($fixtureCounters.failBuild) { throw 'fixture compiler failure' }
        $outIndex = [Array]::IndexOf($arguments, '-o')
        [System.IO.File]::WriteAllText($arguments[$outIndex + 1], 'verified fixture binary')
    }
    $global:LASTEXITCODE = 0
}
$destination = Join-Path $fixtureRoot 'src-tauri/binaries/openusage.exe'
# Leftovers from the previous layout and versions must be removed, not reused.
New-Item -ItemType Directory -Force -Path (Join-Path $buildRoot 'upstream/openusage-0.0.1') | Out-Null
[System.IO.File]::WriteAllText((Join-Path $buildRoot 'source-0.0.1.zip'), 'old')
& $scriptPath
if ($fixtureCounters.downloads -ne 2 -or $fixtureCounters.verifies -ne 1 -or $fixtureCounters.tests -ne 1 -or $fixtureCounters.builds -ne 1) { throw 'First build must verify inputs and modules, test the patches and build.' }
foreach ($leftover in @('upstream', 'source-0.0.1.zip', 'work')) {
    if (Test-Path -LiteralPath (Join-Path $buildRoot $leftover)) { throw "Build must not keep $leftover." }
}
& $scriptPath
if ($fixtureCounters.downloads -ne 2 -or $fixtureCounters.builds -ne 1) { throw 'Verified bundle must be reused.' }
[System.IO.File]::WriteAllText($destination, 'tampered binary')
$rejected = $false
try { & $scriptPath } catch { $rejected = $_.Exception.Message -eq 'Bundled OpenUsage binary has an unexpected checksum.' }
if (!$rejected) { throw 'Modified bundled binary must be rejected.' }
[System.IO.File]::WriteAllText($destination, 'verified fixture binary')
# A modified earlier extraction must be replaced by the verified archive.
$stale = Join-Path $buildRoot "work/upstream/openusage-$version/internal/export"
New-Item -ItemType Directory -Force -Path $stale | Out-Null
[System.IO.File]::WriteAllText((Join-Path $stale 'direct.go'), 'tampered limitviewProviderAccounts(c.resolveAccts(&cfg))')
& $scriptPath -ForceRebuild
if ($fixtureCounters.builds -ne 2) { throw 'Forced rebuild must build from a fresh extraction.' }
$fixtureCounters.failBuild = $true
$rejected = $false
try { & $scriptPath -ForceRebuild } catch { $rejected = $_.Exception.Message -eq 'fixture compiler failure' }
if (!$rejected -or [System.IO.File]::ReadAllText($destination) -ne 'verified fixture binary') { throw 'Failed rebuild must retain the existing binary.' }
$fixtureCounters.failBuild = $false
[System.IO.File]::WriteAllText((Join-Path $buildRoot "source-$version.zip"), 'corrupted input')
$rejected = $false
try { & $scriptPath -ForceRebuild } catch { $rejected = $_.Exception.Message -eq 'Downloaded OpenUsage build input has an unexpected checksum.' }
if (!$rejected) { throw 'Unverified build input must be rejected.' }
Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
Write-Output 'PASS: patched build, legacy cleanup, cache reuse, tamper rejection, fresh extraction, failed-build preservation, source checksum rejection'
