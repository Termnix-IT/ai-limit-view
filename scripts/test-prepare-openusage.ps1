$ErrorActionPreference = 'Stop'

# Exercise the production script with isolated files and a local download stub.
$fixtureRoot = Join-Path $env:TEMP ("limitview-bootstrap-test-" + [guid]::NewGuid().ToString('N'))
$scripts = Join-Path $fixtureRoot 'ProjectFolder\ToolProject\LimitView\scripts'
$candidate = Join-Path $fixtureRoot 'ProjectFolder\Service\LLMDashboard\.local-tools\openusage\openusage.exe'
$destination = Join-Path $scripts '..\src-tauri\binaries\openusage.exe'
New-Item -ItemType Directory -Force -Path $scripts, (Split-Path $candidate), (Join-Path $fixtureRoot 'pinned') | Out-Null

$pinned = Join-Path $fixtureRoot 'pinned\openusage.exe'
[System.IO.File]::WriteAllText($pinned, 'pinned test binary')
$fixtureArchive = Join-Path $fixtureRoot 'pinned.zip'
Compress-Archive -LiteralPath $pinned -DestinationPath $fixtureArchive
$expectedBinaryHash = (Get-FileHash -LiteralPath $pinned -Algorithm SHA256).Hash
$expectedArchiveHash = (Get-FileHash -LiteralPath $fixtureArchive -Algorithm SHA256).Hash
$source = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'prepare-openusage.ps1'))
$source = [regex]::Replace($source, '(?m)^\$binaryHash = ''[A-F0-9]{64}''', ('$$binaryHash = ''' + $expectedBinaryHash + ''''))
$source = [regex]::Replace($source, '(?m)^\$archiveHash = ''[A-F0-9]{64}''', ('$$archiveHash = ''' + $expectedArchiveHash + ''''))
$scriptPath = Join-Path $scripts 'prepare-openusage.ps1'
[System.IO.File]::WriteAllText($scriptPath, $source)

$downloadCalls = [System.Collections.Generic.List[string]]::new()
function Invoke-WebRequest([string]$Uri, [string]$OutFile) {
    $downloadCalls.Add($Uri)
    Copy-Item -LiteralPath $fixtureArchive -Destination $OutFile
}

$previousTemp = $env:TEMP
try {
    $env:TEMP = $fixtureRoot
    [System.IO.File]::WriteAllText($candidate, 'different installed version')
    & $scriptPath
    if ($downloadCalls.Count -ne 1 -or
        $downloadCalls[0] -ne 'https://github.com/janekbaraniewski/openusage/releases/download/v0.25.0/openusage_0.25.0_windows_amd64.zip' -or
        (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $expectedBinaryHash) {
        throw 'A mismatched optional candidate must fall back to the verified pinned download.'
    }

    [System.IO.File]::WriteAllText($destination, 'unexpected bundled file')
    $rejected = $false
    try { & $scriptPath } catch { $rejected = $_.Exception.Message -eq 'Bundled OpenUsage binary has an unexpected checksum.' }
    if (-not $rejected -or $downloadCalls.Count -ne 1) {
        throw 'An unexpected bundled file must still be rejected without downloading.'
    }

    Remove-Item -LiteralPath $destination
    Copy-Item -LiteralPath $pinned -Destination $candidate -Force
    & $scriptPath
    if ($downloadCalls.Count -ne 1 -or
        (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $expectedBinaryHash) {
        throw 'A matching optional candidate must be reused without downloading.'
    }
    Remove-Item -LiteralPath $destination
    [System.IO.File]::WriteAllText($candidate, 'different installed version')
    [System.IO.File]::WriteAllText($fixtureArchive, 'corrupted download')
    $rejected = $false
    try { & $scriptPath } catch { $rejected = $_.Exception.Message -eq 'Downloaded OpenUsage archive has an unexpected checksum.' }
    if (-not $rejected -or (Test-Path -LiteralPath $destination)) {
        throw 'A mismatched download must not be bundled.'
    }
    Write-Output 'PASS: candidate mismatch fallback, bundled checksum rejection, matching candidate reuse, download checksum rejection'
} finally {
    $env:TEMP = $previousTemp
}
