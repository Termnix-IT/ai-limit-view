$ErrorActionPreference = 'Stop'
# Isolated fixtures exercise verified build inputs, filtering, caching and failed builds.
$fixtureRoot = Join-Path $env:TEMP ("limitview-openusage-test-" + [guid]::NewGuid().ToString('N'))
$scripts = Join-Path $fixtureRoot 'scripts'
$buildRoot = Join-Path $fixtureRoot '.openusage-build'
$upstream = Join-Path $fixtureRoot 'fixtures/openusage-0.26.1'
$zigFixture = Join-Path $fixtureRoot 'fixtures/zig-x86_64-windows-0.16.0'
New-Item -ItemType Directory -Force -Path $scripts, $buildRoot, (Join-Path $scripts 'openusage'), (Join-Path $upstream 'internal/export'), $zigFixture, (Join-Path $fixtureRoot 'src-tauri/binaries') | Out-Null
[System.IO.File]::WriteAllText((Join-Path $upstream 'go.mod'), 'module fixture')
[System.IO.File]::WriteAllText((Join-Path $upstream 'internal/export/direct.go'), 'accounts := c.resolveAccts(&cfg)')
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
foreach ($file in @('limitview_filter.go', 'limitview_filter_test.go')) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "openusage/$file") -Destination (Join-Path $scripts "openusage/$file")
}
$fixtureCounters = @{ downloads = 0; tests = 0; builds = 0; failBuild = $false }
function Invoke-WebRequest([string]$Uri, [string]$OutFile, [switch]$UseBasicParsing) {
    $fixtureCounters.downloads++
    Copy-Item -LiteralPath $(if ($Uri -like '*ziglang.org*') { $zigZip } else { $sourceZip }) -Destination $OutFile
}
function go {
    $arguments = $args
    if ($arguments[0] -eq 'test') {
        $fixtureCounters.tests++
        if (![System.IO.File]::ReadAllText((Join-Path (Get-Location) 'internal/export/direct.go')).Contains('limitviewProviderAccounts(c.resolveAccts(&cfg))')) { throw 'Provider filter must be installed before tests.' }
    } else {
        $fixtureCounters.builds++
        if ($fixtureCounters.failBuild) { throw 'fixture compiler failure' }
        $outIndex = [Array]::IndexOf($arguments, '-o')
        [System.IO.File]::WriteAllText($arguments[$outIndex + 1], 'verified fixture binary')
    }
    $global:LASTEXITCODE = 0
}
$destination = Join-Path $fixtureRoot 'src-tauri/binaries/openusage.exe'
& $scriptPath
if ($fixtureCounters.downloads -ne 2 -or $fixtureCounters.tests -ne 1 -or $fixtureCounters.builds -ne 1) { throw 'First build must verify both inputs, test the filter and build.' }
& $scriptPath
if ($fixtureCounters.downloads -ne 2 -or $fixtureCounters.builds -ne 1) { throw 'Verified bundle must be reused.' }
[System.IO.File]::WriteAllText($destination, 'tampered binary')
$rejected = $false
try { & $scriptPath } catch { $rejected = $_.Exception.Message -eq 'Bundled OpenUsage binary has an unexpected checksum.' }
if (!$rejected) { throw 'Modified bundled binary must be rejected.' }
[System.IO.File]::WriteAllText($destination, 'verified fixture binary')
$fixtureCounters.failBuild = $true
$rejected = $false
try { & $scriptPath -ForceRebuild } catch { $rejected = $_.Exception.Message -eq 'fixture compiler failure' }
if (!$rejected -or [System.IO.File]::ReadAllText($destination) -ne 'verified fixture binary') { throw 'Failed rebuild must retain the existing binary.' }
$fixtureCounters.failBuild = $false
[System.IO.File]::WriteAllText((Join-Path $buildRoot 'source.zip'), 'corrupted input')
$rejected = $false
try { & $scriptPath -ForceRebuild } catch { $rejected = $_.Exception.Message -eq 'Downloaded OpenUsage build input has an unexpected checksum.' }
if (!$rejected) { throw 'Unverified build input must be rejected.' }
Write-Output 'PASS: filtered build, cache reuse, tamper rejection, failed-build preservation, source checksum rejection'
