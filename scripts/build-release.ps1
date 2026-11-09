param(
    [string]$KeyPath = (Join-Path $HOME '.tauri/limitview-updater.key'),
    [string]$PasswordPath = (Join-Path $HOME '.tauri/limitview-updater.password')
)
$ErrorActionPreference = 'Stop'
# Builds the signed installer plus latest.json and SHA256SUMS for a GitHub Release.
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = (Get-Content -Raw -LiteralPath (Join-Path $root 'src-tauri/tauri.conf.json') | ConvertFrom-Json).version
foreach ($path in @($KeyPath, $PasswordPath)) {
    if (!(Test-Path -LiteralPath $path)) { throw "Updater signing input not found: $path" }
}
$config = Join-Path ([System.IO.Path]::GetTempPath()) ("limitview-release-" + [guid]::NewGuid().ToString('N') + '.json')
$previous = @{ key = $env:TAURI_SIGNING_PRIVATE_KEY; password = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD; rustflags = $env:CARGO_ENCODED_RUSTFLAGS }
$cargoHome = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $HOME '.cargo' }
Push-Location $root
try {
    # Enabled only here so plain `npm run tauri build` keeps working without the key.
    [System.IO.File]::WriteAllText($config, '{"bundle":{"createUpdaterArtifacts":true}}')
    # Panic locations embed absolute source paths, including the build user's name.
    # The last matching prefix wins, so the home directory is only the fallback.
    $env:CARGO_ENCODED_RUSTFLAGS = @(
        "--remap-path-prefix=$HOME=~",
        "--remap-path-prefix=$cargoHome=/cargo",
        "--remap-path-prefix=$root=/limitview"
    ) -join [char]0x1f
    $env:TAURI_SIGNING_PRIVATE_KEY = ([System.IO.File]::ReadAllText($KeyPath)).Trim()
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ([System.IO.File]::ReadAllText($PasswordPath)).Trim()
    & npm run tauri build -- --config $config
    if ($LASTEXITCODE -ne 0) { throw 'Tauri release build failed.' }
} finally {
    $env:TAURI_SIGNING_PRIVATE_KEY = $previous.key
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $previous.password
    $env:CARGO_ENCODED_RUSTFLAGS = $previous.rustflags
    Remove-Item -LiteralPath $config -Force -ErrorAction SilentlyContinue
    Pop-Location
}
$bundle = Join-Path $root 'src-tauri/target/release/bundle/nsis'
$installerName = "LimitView_${version}_x64-setup.exe"
$installer = Join-Path $bundle $installerName
$signature = "$installer.sig"
foreach ($path in @($installer, $signature)) {
    if (!(Test-Path -LiteralPath $path)) { throw "Release build output not found: $path" }
}
# Refuse to publish a binary that still reveals the build machine's home directory.
$executable = Join-Path $root 'src-tauri/target/release/ai-limitusage-watcher.exe'
if ([System.IO.File]::ReadAllText($executable, [System.Text.Encoding]::Default).Contains($HOME)) {
    throw 'Release executable still contains the build user home path.'
}
$encoding = New-Object System.Text.UTF8Encoding($false)
$manifest = [ordered]@{
    version   = $version
    pub_date  = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    platforms = @{
        'windows-x86_64' = @{
            signature = ([System.IO.File]::ReadAllText($signature)).Trim()
            url       = "https://github.com/Termnix-IT/ai-limit-view/releases/download/v$version/$installerName"
        }
    }
}
[System.IO.File]::WriteAllText((Join-Path $bundle 'latest.json'), ($manifest | ConvertTo-Json -Depth 4), $encoding)
$hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText((Join-Path $bundle "LimitView_${version}_SHA256SUMS.txt"), "$hash  $installerName`n", $encoding)
Write-Output "Release assets: $installerName, latest.json, LimitView_${version}_SHA256SUMS.txt"
