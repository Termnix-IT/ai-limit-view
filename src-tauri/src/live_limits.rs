use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::Manager;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::ChildStdout;

const CODEX_TIMEOUT: Duration = Duration::from_secs(25);
const OPENUSAGE_TIMEOUT: Duration = Duration::from_secs(60);
const AUTH_COOLDOWN: Duration = Duration::from_secs(30 * 60);

#[derive(Default)]
struct ClaudeRecovery {
    cooldown_until: Option<std::time::Instant>,
    failure: Option<LimitError>,
}

fn claude_recovery() -> &'static tokio::sync::Mutex<ClaudeRecovery> {
    static STATE: OnceLock<tokio::sync::Mutex<ClaudeRecovery>> = OnceLock::new();
    STATE.get_or_init(|| tokio::sync::Mutex::new(ClaudeRecovery::default()))
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitWindow {
    used_percent: f64,
    remaining_percent: f64,
    resets_at: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderLimits {
    status: &'static str,
    source: &'static str,
    checked_at: String,
    five_hour: Option<LimitWindow>,
    weekly: Option<LimitWindow>,
    message: Option<&'static str>,
    error_code: Option<&'static str>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LimitError {
    CodexNotFound,
    CodexStart,
    CodexTimeout,
    CodexRead,
    CodexAccount,
    CodexData,
    OpenUsageNotFound,
    OpenUsageRun,
    OpenUsageTimeout,
    ClaudeAuthExpired,
    ClaudeRefreshNotFound,
    ClaudeRefreshStart,
    ClaudeRefreshTimeout,
    ClaudeRefreshFailed,
    ClaudeAuthRequired,
    ClaudeAuthRejected,
    ClaudeRateLimited,
    ClaudeServer,
    ClaudeNetwork,
    ClaudeApi,
    ClaudeData,
}

impl LimitError {
    fn code(self) -> &'static str {
        match self {
            Self::CodexNotFound => "codex_not_found",
            Self::OpenUsageNotFound => "openusage_not_found",
            Self::ClaudeAuthExpired => "auth_expired",
            Self::ClaudeRefreshNotFound => "auth_refresh_cli_missing",
            Self::ClaudeRefreshStart => "auth_refresh_start_failed",
            Self::ClaudeRefreshTimeout => "auth_refresh_timeout",
            Self::ClaudeRefreshFailed => "auth_refresh_failed",
            Self::ClaudeAuthRequired | Self::CodexAccount => "auth_required",
            Self::ClaudeAuthRejected => "auth_rejected",
            Self::ClaudeRateLimited => "rate_limited",
            Self::ClaudeServer => "server_error",
            Self::ClaudeNetwork => "network_error",
            Self::ClaudeApi => "api_error",
            Self::CodexTimeout | Self::OpenUsageTimeout => "timeout",
            _ => "fetch_failed",
        }
    }

    fn message(self) -> &'static str {
        match self {
            Self::CodexNotFound => "Codex CLI が見つかりません。Codex デスクトップアプリまたは CLI をインストールしてください。",
            Self::CodexStart => "Codex CLI を起動できません。Codex のインストール状態を確認してください。",
            Self::CodexTimeout => "Codex の取得がタイムアウトしました。再読み込みしてください。",
            Self::CodexRead => "Codex CLI との通信に失敗しました。Codex を更新して再読み込みしてください。",
            Self::CodexAccount => "Codex アカウントの利用枠を取得できません。Codex のログイン状態と契約を確認してください。",
            Self::CodexData => "Codex から利用枠のデータが返りませんでした。",
            Self::OpenUsageNotFound => "同梱 OpenUsage が見つかりません。LimitView を再インストールしてください。",
            Self::OpenUsageRun => "OpenUsage の実行に失敗しました。再読み込みしてください。",
            Self::OpenUsageTimeout => "OpenUsage の取得がタイムアウトしました。再読み込みしてください。",
            Self::ClaudeAuthExpired => "Claude Code の認証期限が切れており、自動更新で復旧できませんでした。Claude Code を起動し、必要なら /login 後に再読み込みしてください。失敗後30分間は自動更新の再起動を控えます。",
            Self::ClaudeRefreshNotFound => "認証期限が切れていますが、更新用の Claude Code CLI が見つかりません。CLI のインストール状態を確認し、Claude Code を起動してから再読み込みしてください。失敗後30分間は自動更新の再起動を控えます。",
            Self::ClaudeRefreshStart => "Claude Code の認証更新処理を起動できませんでした。Claude Code を手動で起動してから再読み込みしてください。失敗後30分間は自動更新の再起動を控えます。",
            Self::ClaudeRefreshTimeout => "Claude Code の認証更新が20秒以内に終了しなかったため停止しました。Claude Code を手動で起動し、必要なら /login 後に再読み込みしてください。失敗後30分間は自動更新の再起動を控えます。",
            Self::ClaudeRefreshFailed => "Claude Code の認証更新処理が正常終了しませんでした。Claude Code を手動で起動し、必要なら /login 後に再読み込みしてください。失敗後30分間は自動更新の再起動を控えます。",
            Self::ClaudeAuthRequired => "Claude Code の認証情報がありません。Claude Code で /login を実行してから再読み込みしてください。",
            Self::ClaudeAuthRejected => "Claude の利用枠 API が認証・アクセスを拒否しました（401/403）。Claude Code の /usage を確認し、認証エラーが出る場合は /login でログインし直してください。",
            Self::ClaudeRateLimited => "Claude の利用枠 API の取得頻度が制限されています（429）。待機後に自動で再試行します。再読み込みでも待機時間は短縮しません。",
            Self::ClaudeServer => "Claude の利用枠 API でサーバーエラーが発生しました（5xx）。時間をおいて自動で再試行します。",
            Self::ClaudeNetwork => "Claude の利用枠 API との通信に失敗しました。接続・VPN・プロキシの状態を確認してください。時間をおいて自動で再試行します。",
            Self::ClaudeApi => "Claude の利用枠 API に接続できません。Claude Code の /usage を確認し、時間をおいて再読み込みしてください。",
            Self::ClaudeData => "OpenUsage から Claude の利用枠が返りませんでした。Claude Code のログイン状態と契約を確認してください。",
        }
    }
}

type WindowsResult = Result<(Option<LimitWindow>, Option<LimitWindow>), LimitError>;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    Codex,
    ClaudeCode,
}

fn window(used: Option<f64>, resets_at: Option<Value>) -> Option<LimitWindow> {
    let used = used.filter(|n| n.is_finite() && (0.0..=100.0).contains(n))?;
    Some(LimitWindow {
        used_percent: used,
        remaining_percent: ((100.0 - used) * 10.0).round() / 10.0,
        resets_at: resets_at.filter(|v| v.is_string() || v.is_number()),
    })
}

fn provider_result(
    result: WindowsResult,
    source: &'static str,
    empty_error: LimitError,
) -> ProviderLimits {
    let (status, five_hour, weekly, error) = match result {
        Ok((five_hour, weekly)) if five_hour.is_some() || weekly.is_some() => {
            ("ok", five_hour, weekly, None)
        }
        Ok(_) => ("unavailable", None, None, Some(empty_error)),
        Err(error) => ("unavailable", None, None, Some(error)),
    };
    ProviderLimits {
        status,
        source,
        checked_at: chrono::Utc::now().to_rfc3339(),
        five_hour,
        weekly,
        message: error.map(LimitError::message),
        error_code: error.map(LimitError::code),
    }
}

#[tauri::command]
pub async fn get_provider_limits(app: tauri::AppHandle, provider: Provider) -> ProviderLimits {
    if matches!(provider, Provider::Codex) {
        return provider_result(
            codex_limits().await,
            "Codex app-server",
            LimitError::CodexData,
        );
    }
    let openusage = app
        .path()
        .resource_dir()
        .ok()
        .map(|path| path.join("binaries").join("openusage.exe"))
        .filter(|path| path.is_file())
        .or_else(|| {
            let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("binaries")
                .join("openusage.exe");
            path.is_file().then_some(path)
        });
    let result = match openusage {
        Some(path) => {
            // Serialize Claude requests through the entire fetch/recovery/fetch cycle.
            // Codex remains independent. Never hold a synchronous lock across awaits.
            let mut recovery = claude_recovery().lock().await;
            let working_dir = app
                .path()
                .app_local_data_dir()
                .ok()
                .map(|dir| dir.join("auth-refresh"));
            claude_with_recovery(
                &mut recovery,
                || claude_limits(&path),
                || async {
                    let dir = working_dir.ok_or(crate::claude_auth::RefreshError::Start)?;
                    crate::claude_auth::refresh(&dir).await
                },
            )
            .await
        }
        None => Err(LimitError::OpenUsageNotFound),
    };
    provider_result(result, "OpenUsage", LimitError::ClaudeData)
}

fn find_codex(
    local_app_data: Option<&Path>,
    search_path: Option<&std::ffi::OsStr>,
) -> Option<PathBuf> {
    // Explorer-launched apps do not inherit the Codex task's private PATH.
    if let Some(local) = local_app_data {
        let bin = local.join("OpenAI").join("Codex").join("bin");
        let mut candidates: Vec<PathBuf> = std::fs::read_dir(&bin)
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .map(|entry| entry.path().join("codex.exe"))
            .filter(|path| path.is_file())
            .collect();
        candidates.sort_by_key(|path| path.metadata().and_then(|meta| meta.modified()).ok());
        if let Some(path) = candidates.pop() {
            return Some(path);
        }
        let unversioned = bin.join("codex.exe");
        if unversioned.is_file() {
            return Some(unversioned);
        }
    }
    // Resolve npm's native binary without executing its .cmd shim or searching cwd.
    search_path.and_then(|path| {
        std::env::split_paths(path)
            .filter(|dir| dir.is_absolute())
            .find_map(|dir| {
                let exe = dir.join("codex.exe");
                exe.is_file().then_some(exe).or_else(|| npm_codex(&dir))
            })
    })
}

fn npm_codex(prefix: &Path) -> Option<PathBuf> {
    let (package, target) = match std::env::consts::ARCH {
        "x86_64" => ("codex-win32-x64", "x86_64-pc-windows-msvc"),
        "aarch64" => ("codex-win32-arm64", "aarch64-pc-windows-msvc"),
        _ => return None,
    };
    let openai = prefix.join("node_modules/@openai");
    let codex = openai.join("codex");
    [
        codex
            .join("node_modules/@openai")
            .join(package)
            .join("vendor"),
        openai.join(package).join("vendor"),
        codex.join("vendor"),
    ]
    .into_iter()
    .map(|vendor| vendor.join(target).join("codex/codex.exe"))
    .find(|path| path.is_file())
}

async fn codex_limits() -> WindowsResult {
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let path = find_codex(local.as_deref(), std::env::var_os("PATH").as_deref())
        .or_else(|| {
            std::env::var_os("APPDATA")
                .map(PathBuf::from)
                .filter(|path| path.is_absolute())
                .and_then(|path| npm_codex(&path.join("npm")))
        })
        .ok_or(LimitError::CodexNotFound)?;
    tokio::time::timeout(CODEX_TIMEOUT, codex_from_path(&path))
        .await
        .unwrap_or(Err(LimitError::CodexTimeout))
}

async fn codex_from_path(path: &Path) -> WindowsResult {
    let mut command = crate::process::background_command(path);
    command
        .command_mut()
        .args(["app-server", "--listen", "stdio://"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = command.spawn().map_err(|_| LimitError::CodexStart)?;
    let stdout = child.stdout().take().ok_or(LimitError::CodexRead)?;
    let mut lines = BufReader::new(stdout).lines();
    // Keep the job-owning child alive until the RPC finishes; Drop also handles errors.
    let stdin = child.stdin().as_mut().ok_or(LimitError::CodexRead)?;
    send_rpc(
        stdin,
        json!({"id": 1, "method": "initialize", "params": {
            "clientInfo": {"name": "limitview", "title": "LimitView", "version": env!("CARGO_PKG_VERSION")}
        }}),
    ).await?;
    read_rpc(&mut lines, 1).await?;
    send_rpc(stdin, json!({"method": "initialized", "params": {}})).await?;
    send_rpc(
        stdin,
        json!({"id": 2, "method": "account/rateLimits/read", "params": {}}),
    )
    .await?;
    parse_codex(&read_rpc(&mut lines, 2).await?)
}

async fn send_rpc(
    stdin: &mut (impl tokio::io::AsyncWrite + Unpin),
    value: Value,
) -> Result<(), LimitError> {
    stdin
        .write_all(format!("{value}\n").as_bytes())
        .await
        .map_err(|_| LimitError::CodexRead)?;
    stdin.flush().await.map_err(|_| LimitError::CodexRead)
}

async fn read_rpc(lines: &mut Lines<BufReader<ChildStdout>>, id: i64) -> Result<Value, LimitError> {
    loop {
        let line = lines
            .next_line()
            .await
            .map_err(|_| LimitError::CodexRead)?
            .ok_or(LimitError::CodexRead)?;
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if message.get("id").and_then(Value::as_i64) == Some(id) {
            if message.get("error").is_some() {
                return Err(if id == 2 {
                    LimitError::CodexAccount
                } else {
                    LimitError::CodexRead
                });
            }
            return message.get("result").cloned().ok_or(LimitError::CodexData);
        }
    }
}

fn parse_codex(data: &Value) -> WindowsResult {
    let limits = data
        .pointer("/rateLimitsByLimitId/codex")
        .filter(|v| v.is_object())
        .or_else(|| data.get("rateLimits"))
        .ok_or(LimitError::CodexData)?;
    let mut result = (None, None);
    for item in [limits.get("primary"), limits.get("secondary")]
        .into_iter()
        .flatten()
    {
        let entry = window(
            item.get("usedPercent").and_then(Value::as_f64),
            item.get("resetsAt").cloned(),
        );
        match item.get("windowDurationMins").and_then(Value::as_u64) {
            Some(300) => result.0 = entry,
            Some(10080) => result.1 = entry,
            _ => {}
        }
    }
    Ok(result)
}

async fn claude_limits(path: &Path) -> WindowsResult {
    let output = run_with_timeout(
        path,
        &["export", "--output", "-", "--source", "direct"],
        OPENUSAGE_TIMEOUT,
    )
    .await?;
    parse_claude(&output)
}

async fn claude_with_recovery<F, FF, R, RF>(
    state: &mut ClaudeRecovery,
    mut fetch: F,
    refresh: R,
) -> WindowsResult
where
    F: FnMut() -> FF,
    FF: std::future::Future<Output = WindowsResult>,
    R: FnOnce() -> RF,
    RF: std::future::Future<Output = Result<(), crate::claude_auth::RefreshError>>,
{
    let result = fetch().await;
    if result.is_ok() {
        *state = ClaudeRecovery::default();
        return result;
    }
    if result.as_ref().err() != Some(&LimitError::ClaudeAuthExpired) {
        return result;
    }
    if state
        .cooldown_until
        .is_some_and(|until| std::time::Instant::now() < until)
    {
        return Err(state.failure.unwrap_or(LimitError::ClaudeAuthExpired));
    }
    // Set before starting: cancellation must not permit repeated CLI launches.
    state.cooldown_until = Some(std::time::Instant::now() + AUTH_COOLDOWN);
    state.failure = Some(LimitError::ClaudeAuthExpired);
    let result = match refresh().await {
        Ok(()) => fetch().await,
        Err(error) => Err(match error {
            crate::claude_auth::RefreshError::NotFound => LimitError::ClaudeRefreshNotFound,
            crate::claude_auth::RefreshError::Start => LimitError::ClaudeRefreshStart,
            crate::claude_auth::RefreshError::Timeout => LimitError::ClaudeRefreshTimeout,
            crate::claude_auth::RefreshError::Failed => LimitError::ClaudeRefreshFailed,
        }),
    };
    if result.is_ok() {
        *state = ClaudeRecovery::default();
    } else {
        // The full cooldown starts after failure, including a slow second fetch.
        state.cooldown_until = Some(std::time::Instant::now() + AUTH_COOLDOWN);
        state.failure = result.as_ref().err().copied().filter(|error| {
            matches!(
                error,
                LimitError::ClaudeRefreshNotFound
                    | LimitError::ClaudeRefreshStart
                    | LimitError::ClaudeRefreshTimeout
                    | LimitError::ClaudeRefreshFailed
            )
        });
    }
    result
}

fn parse_claude(output: &[u8]) -> WindowsResult {
    let payload: Value = serde_json::from_slice(output).map_err(|_| LimitError::ClaudeData)?;
    let snapshots = payload
        .get("snapshots")
        .and_then(Value::as_array)
        .ok_or(LimitError::ClaudeData)?;
    let mut first_error = None;
    for snapshot in snapshots
        .iter()
        .filter(|row| row.get("provider_id").and_then(Value::as_str) == Some("claude_code"))
    {
        match parse_claude_snapshot(snapshot) {
            // Select one account's windows together; never combine different accounts.
            Ok(limits) => return Ok(limits),
            Err(error) => {
                first_error.get_or_insert(error);
            }
        }
    }
    Err(first_error.unwrap_or(LimitError::ClaudeData))
}

fn parse_claude_snapshot(snapshot: &Value) -> WindowsResult {
    let metric = |name: &str| {
        window(
            snapshot
                .pointer(&format!("/metrics/{name}/used"))
                .and_then(Value::as_f64),
            snapshot.get("resets").and_then(|r| r.get(name)).cloned(),
        )
    };
    let result = (metric("usage_five_hour"), metric("usage_seven_day"));
    if result.0.is_none() && result.1.is_none() {
        let diagnostic = snapshot
            .pointer("/diagnostics/usage_api_error")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_lowercase();
        // Only classified messages reach the UI; provider diagnostics may contain private data.
        return Err(classify_claude_error(&diagnostic));
    }
    Ok(result)
}

fn classify_claude_error(diagnostic: &str) -> LimitError {
    // On Windows the unsupported cookie source precedes the actual OAuth error.
    let diagnostic = diagnostic
        .rsplit_once("; oauth: ")
        .map_or(diagnostic, |(_, oauth)| oauth);
    // Match explicit HTTP markers, not arbitrary numbers or words in response bodies.
    let status = ["api returned ", "http status ", "http ", "status code "]
        .iter()
        .find_map(|marker| {
            let rest = diagnostic.split_once(marker)?.1;
            let code = rest.get(..3)?;
            if rest.as_bytes().get(3).is_some_and(u8::is_ascii_digit) {
                return None;
            }
            code.parse::<u16>().ok()
        });
    if let Some(status) = status {
        return match status {
            401 | 403 => LimitError::ClaudeAuthRejected,
            429 => LimitError::ClaudeRateLimited,
            500..=599 => LimitError::ClaudeServer,
            _ => LimitError::ClaudeApi,
        };
    }
    if diagnostic.contains("token expired") {
        LimitError::ClaudeAuthExpired
    } else if diagnostic.contains("no oauth")
        || diagnostic.contains("no credentials")
        || (diagnostic.contains("reading claude code credentials")
            && (diagnostic.contains("no such file") || diagnostic.contains("cannot find")))
        || diagnostic == "credentials not found"
    {
        LimitError::ClaudeAuthRequired
    } else if diagnostic.contains("api request failed")
        || diagnostic.contains("connection refused")
        || diagnostic.contains("connection reset")
        || diagnostic.contains("no such host")
        || diagnostic.contains("tls handshake")
        || diagnostic.contains("context deadline exceeded")
        || diagnostic.contains("timeout")
        || diagnostic.contains("timed out")
    {
        LimitError::ClaudeNetwork
    } else if diagnostic.is_empty() {
        LimitError::ClaudeData
    } else {
        LimitError::ClaudeApi
    }
}

async fn run_with_timeout(
    path: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<Vec<u8>, LimitError> {
    // The same deadline covers process execution AND EOF, including inherited pipes.
    tokio::time::timeout(timeout, async {
        let mut command = crate::process::background_command(path);
        command
            .command_mut()
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let mut child = command.spawn().map_err(|_| LimitError::OpenUsageRun)?;
        let stdout = child.stdout().take().ok_or(LimitError::OpenUsageRun)?;
        let reader = async move {
            let mut bytes = Vec::new();
            stdout
                .take(4 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .await
                .map_err(|_| LimitError::OpenUsageRun)?;
            if bytes.len() > 4 * 1024 * 1024 {
                return Err(LimitError::OpenUsageRun);
            }
            Ok(bytes)
        };
        let wait = async {
            loop {
                let status = child.try_wait().map_err(|_| LimitError::OpenUsageRun)?;
                if let Some(status) = status {
                    return if status.success() {
                        Ok(())
                    } else {
                        Err(LimitError::OpenUsageRun)
                    };
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        };
        let (_, output) = tokio::try_join!(wait, reader)?;
        Ok(output)
    })
    .await
    .unwrap_or(Err(LimitError::OpenUsageTimeout))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovery_retries_expiry_once_and_clears_cooldown_on_success() {
        tauri::async_runtime::block_on(async {
            let mut state = ClaudeRecovery::default();
            let mut calls = 0;
            let result = claude_with_recovery(
                &mut state,
                || {
                    calls += 1;
                    std::future::ready(if calls == 1 {
                        Err(LimitError::ClaudeAuthExpired)
                    } else {
                        Ok((Some(window(Some(20.0), None).unwrap()), None))
                    })
                },
                || async { Ok(()) },
            )
            .await;
            assert!(result.is_ok());
            assert_eq!(calls, 2);
            assert!(state.cooldown_until.is_none());
        });
    }

    #[test]
    fn recovery_skips_other_errors_and_blocks_repeated_refresh() {
        tauri::async_runtime::block_on(async {
            let mut state = ClaudeRecovery::default();
            for error in [
                LimitError::ClaudeRateLimited,
                LimitError::ClaudeAuthRejected,
                LimitError::ClaudeAuthRequired,
                LimitError::ClaudeNetwork,
            ] {
                let result = claude_with_recovery(
                    &mut state,
                    || std::future::ready(Err(error)),
                    || async { panic!("must not refresh other errors") },
                )
                .await;
                assert_eq!(result.unwrap_err(), error);
            }
            let result = claude_with_recovery(
                &mut state,
                || std::future::ready(Err(LimitError::ClaudeAuthExpired)),
                || async { Err(crate::claude_auth::RefreshError::NotFound) },
            )
            .await;
            assert_eq!(result.unwrap_err(), LimitError::ClaudeRefreshNotFound);
            let result = claude_with_recovery(
                &mut state,
                || std::future::ready(Err(LimitError::ClaudeAuthExpired)),
                || async { panic!("cooldown must prevent refresh") },
            )
            .await;
            assert_eq!(result.unwrap_err(), LimitError::ClaudeRefreshNotFound);
            let result = claude_with_recovery(
                &mut state,
                || std::future::ready(Ok((Some(window(Some(10.0), None).unwrap()), None))),
                || async { panic!("success must not refresh") },
            )
            .await;
            assert!(result.is_ok());
            assert!(state.cooldown_until.is_none());
        });
    }

    #[test]
    fn recovery_preserves_second_fetch_error_and_does_not_loop() {
        tauri::async_runtime::block_on(async {
            for error in [
                LimitError::ClaudeAuthExpired,
                LimitError::ClaudeRateLimited,
                LimitError::ClaudeNetwork,
            ] {
                let mut state = ClaudeRecovery::default();
                let mut calls = 0;
                let result = claude_with_recovery(
                    &mut state,
                    || {
                        calls += 1;
                        std::future::ready(Err(if calls == 1 {
                            LimitError::ClaudeAuthExpired
                        } else {
                            error
                        }))
                    },
                    || async { Ok(()) },
                )
                .await;
                assert_eq!(result.unwrap_err(), error);
                assert_eq!(calls, 2);
                assert!(state.cooldown_until.is_some());
                state.cooldown_until = Some(std::time::Instant::now() - Duration::from_secs(1));
                let result = claude_with_recovery(
                    &mut state,
                    || std::future::ready(Err(LimitError::ClaudeAuthExpired)),
                    || async { Err(crate::claude_auth::RefreshError::Timeout) },
                )
                .await;
                assert_eq!(result.unwrap_err(), LimitError::ClaudeRefreshTimeout);
            }
        });
    }

    #[test]
    fn cancelled_recovery_retains_cooldown() {
        tauri::async_runtime::block_on(async {
            let mut state = ClaudeRecovery::default();
            let result = tokio::time::timeout(
                Duration::from_millis(10),
                claude_with_recovery(
                    &mut state,
                    || std::future::ready(Err(LimitError::ClaudeAuthExpired)),
                    || std::future::pending(),
                ),
            )
            .await;
            assert!(result.is_err());
            let result = claude_with_recovery(
                &mut state,
                || std::future::ready(Err(LimitError::ClaudeAuthExpired)),
                || async { panic!("cancelled update must not launch repeatedly") },
            )
            .await;
            assert_eq!(result.unwrap_err(), LimitError::ClaudeAuthExpired);
        });
    }

    #[test]
    fn maps_codex_windows_by_duration() {
        let data = json!({"rateLimitsByLimitId": {"codex": {
            "primary": {"windowDurationMins": 300, "usedPercent": 15.0, "resetsAt": 123},
            "secondary": {"windowDurationMins": 10080, "usedPercent": 32.0, "resetsAt": 456}
        }}});
        let (five, weekly) = parse_codex(&data).unwrap();
        assert_eq!(five.unwrap().remaining_percent, 85.0);
        assert_eq!(weekly.unwrap().remaining_percent, 68.0);
    }

    #[test]
    fn rejects_invalid_percentage() {
        assert!(window(Some(101.0), None).is_none());
        assert!(window(Some(f64::NAN), None).is_none());
    }

    #[test]
    fn maps_claude_subscription_windows_only() {
        let payload = json!({"snapshots": [{
            "provider_id": "claude_code",
            "metrics": {
                "usage_five_hour": {"used": 7},
                "usage_seven_day": {"used": 32},
                "burn_rate": {"used": 99}
            },
            "resets": {"usage_five_hour": "2026-09-27T04:50:00Z"}
        }]});
        let (five, weekly) = parse_claude(payload.to_string().as_bytes()).unwrap();
        assert_eq!(five.unwrap().remaining_percent, 93.0);
        assert_eq!(weekly.unwrap().remaining_percent, 68.0);
    }

    #[test]
    fn selects_first_valid_claude_snapshot_after_failed_or_invalid_accounts() {
        for used in [0, 7, 100] {
            let payload = json!({"snapshots": [
                {"provider_id": "codex", "metrics": {"usage_five_hour": {"used": 50}}},
                {"provider_id": "claude_code", "metrics": {},
                 "diagnostics": {"usage_api_error": "no credentials"}},
                {"provider_id": "claude_code", "metrics": {
                    "usage_five_hour": {"used": 101}, "usage_seven_day": {"used": "invalid"}
                }},
                {"provider_id": "claude_code", "status": "OK", "metrics": {
                    "burn_rate": {"used": 99}
                }},
                {"provider_id": "claude_code", "metrics": {
                    "usage_five_hour": {"used": used}, "usage_seven_day": {"used": 32}
                 }, "resets": {
                    "usage_five_hour": "2026-09-27T04:50:00Z",
                    "usage_seven_day": "2026-10-01T00:00:00Z"
                }},
                {"provider_id": "claude_code", "metrics": {
                    "usage_five_hour": {"used": 15}, "usage_seven_day": {"used": 20}
                }}
            ]});
            let (five, weekly) = parse_claude(payload.to_string().as_bytes()).unwrap();
            let five = five.unwrap();
            let weekly = weekly.unwrap();
            assert_eq!(five.remaining_percent, (100 - used) as f64);
            assert_eq!(weekly.remaining_percent, 68.0);
            assert_eq!(five.resets_at, Some(json!("2026-09-27T04:50:00Z")));
            assert_eq!(weekly.resets_at, Some(json!("2026-10-01T00:00:00Z")));
        }
    }

    #[test]
    fn keeps_first_valid_claude_accounts_windows_together() {
        let payload = json!({"snapshots": [
            {"provider_id": "claude_code", "metrics": {"usage_five_hour": {"used": 7}}},
            {"provider_id": "claude_code", "metrics": {
                "usage_five_hour": {"used": 15}, "usage_seven_day": {"used": 32}
            }}
        ]});
        let (five, weekly) = parse_claude(payload.to_string().as_bytes()).unwrap();
        assert_eq!(five.unwrap().remaining_percent, 93.0);
        assert!(weekly.is_none());
    }

    #[test]
    fn accepts_weekly_only_claude_snapshot_after_an_account_failure() {
        let payload = json!({"snapshots": [
            {"provider_id": "claude_code", "metrics": {},
             "diagnostics": {"usage_api_error": "token expired"}},
            {"provider_id": "claude_code", "metrics": {"usage_seven_day": {"used": 32}}},
            {"provider_id": "claude_code", "metrics": {"usage_five_hour": {"used": 7}}}
        ]});
        let (five, weekly) = parse_claude(payload.to_string().as_bytes()).unwrap();
        assert!(five.is_none());
        assert_eq!(weekly.unwrap().remaining_percent, 68.0);
    }

    #[test]
    fn preserves_first_claude_error_when_all_accounts_fail() {
        for (diagnostic, expected) in [
            ("token expired", LimitError::ClaudeAuthExpired),
            ("no credentials", LimitError::ClaudeAuthRequired),
            (
                "HTTP 429 private-account-data",
                LimitError::ClaudeRateLimited,
            ),
            ("", LimitError::ClaudeData),
        ] {
            let payload = json!({"snapshots": [
                {"provider_id": "codex", "metrics": {"usage_five_hour": {"used": 7}}},
                {"provider_id": "claude_code", "metrics": {},
                 "diagnostics": {"usage_api_error": diagnostic}},
                {"provider_id": "claude_code", "metrics": {},
                 "diagnostics": {"usage_api_error": "different failure"}}
            ]});
            assert_eq!(
                parse_claude(payload.to_string().as_bytes()).unwrap_err(),
                expected
            );
        }
    }

    #[test]
    fn rejects_exports_without_claude_snapshots() {
        for payload in [
            json!({}),
            json!({"snapshots": null}),
            json!({"snapshots": []}),
            json!({"snapshots": [{"provider_id": "codex", "metrics": {
                "usage_five_hour": {"used": 7}
            }}]}),
        ] {
            assert_eq!(
                parse_claude(payload.to_string().as_bytes()).unwrap_err(),
                LimitError::ClaudeData
            );
        }
    }

    #[test]
    fn discovers_desktop_codex_without_path_and_prefers_versioned_cli() {
        let local = tempfile::tempdir().unwrap();
        let bin = local.path().join("OpenAI/Codex/bin");
        std::fs::create_dir_all(bin.join("version-a")).unwrap();
        std::fs::create_dir_all(bin.join("non-executable-newer-directory")).unwrap();
        let versioned = bin.join("version-a/codex.exe");
        std::fs::write(bin.join("codex.exe"), []).unwrap();
        std::fs::write(&versioned, []).unwrap();
        assert_eq!(find_codex(Some(local.path()), None), Some(versioned));
    }

    #[test]
    fn falls_back_to_exe_in_path_and_ignores_cmd_shims() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("codex.cmd"), []).unwrap();
        assert!(find_codex(None, Some(directory.path().as_os_str())).is_none());
        let exe = directory.path().join("codex.exe");
        std::fs::write(&exe, []).unwrap();
        assert_eq!(
            find_codex(None, Some(directory.path().as_os_str())),
            Some(exe)
        );
    }

    #[test]
    fn discovers_npm_native_binary_in_supported_layouts_without_running_cmd() {
        let (package, target) = match std::env::consts::ARCH {
            "x86_64" => ("codex-win32-x64", "x86_64-pc-windows-msvc"),
            "aarch64" => ("codex-win32-arm64", "aarch64-pc-windows-msvc"),
            _ => return,
        };
        for vendor in [
            format!("node_modules/@openai/codex/node_modules/@openai/{package}/vendor"),
            format!("node_modules/@openai/{package}/vendor"),
            "node_modules/@openai/codex/vendor".to_string(),
        ] {
            let prefix = tempfile::tempdir().unwrap();
            let exe = prefix
                .path()
                .join(vendor)
                .join(target)
                .join("codex/codex.exe");
            std::fs::create_dir_all(exe.parent().unwrap()).unwrap();
            std::fs::write(&exe, []).unwrap();
            std::fs::write(prefix.path().join("codex.cmd"), b"do not run").unwrap();
            assert_eq!(find_codex(None, Some(prefix.path().as_os_str())), Some(exe));
        }
        assert!(find_codex(None, Some(std::ffi::OsStr::new("."))).is_none());
    }

    #[cfg(windows)]
    #[test]
    fn inherited_stdout_cannot_exceed_retrieval_deadline() {
        tauri::async_runtime::block_on(async {
            let started = std::time::Instant::now();
            let result = run_with_timeout(
                &std::env::current_exe().unwrap(),
                &[
                    "--ignored",
                    "--exact",
                    "process::tests::descendant_fixture",
                    "--nocapture",
                ],
                Duration::from_millis(250),
            )
            .await;
            assert_eq!(result.unwrap_err(), LimitError::OpenUsageTimeout);
            assert!(started.elapsed() < Duration::from_secs(2));
        });
    }

    #[test]
    fn expired_claude_auth_is_reported_even_when_export_status_is_ok() {
        let payload = json!({"snapshots": [{
            "provider_id": "claude_code", "status": "OK",
            "metrics": {"burn_rate": {"used": 99}},
            "diagnostics": {"usage_api_error": "cookie extraction only supported on macOS; oauth: Claude Code OAuth token expired (refreshed on next Claude Code use)"}
        }]});
        let result = parse_claude(payload.to_string().as_bytes());
        assert_eq!(result.unwrap_err(), LimitError::ClaudeAuthExpired);
        let provider = provider_result(
            Err(LimitError::ClaudeAuthExpired),
            "OpenUsage",
            LimitError::ClaudeData,
        );
        assert_eq!(provider.status, "unavailable");
        assert_eq!(provider.error_code, Some("auth_expired"));
        assert!(provider.message.unwrap().contains("/login"));
    }

    #[test]
    fn missing_quota_metrics_do_not_become_zero_or_raw_diagnostics() {
        let payload = json!({"snapshots": [{
            "provider_id": "claude_code", "metrics": {},
            "diagnostics": {"usage_api_error": "HTTP 429 private-account-data"}
        }]});
        let result = parse_claude(payload.to_string().as_bytes());
        assert_eq!(result.unwrap_err(), LimitError::ClaudeRateLimited);
        assert!(!LimitError::ClaudeRateLimited
            .message()
            .contains("private-account-data"));
        let provider = provider_result(Ok((None, None)), "Codex app-server", LimitError::CodexData);
        assert!(provider.five_hour.is_none());
        assert_eq!(provider.status, "unavailable");
    }

    #[test]
    fn classifies_claude_api_failures_without_exposing_diagnostics() {
        for (diagnostic, expected, code) in [
            (
                "API returned 429: private-account-data missing",
                LimitError::ClaudeRateLimited,
                "rate_limited",
            ),
            (
                "HTTP 429 private-account-data",
                LimitError::ClaudeRateLimited,
                "rate_limited",
            ),
            (
                "cookie source not found; oauth: API returned 429: private-account-data",
                LimitError::ClaudeRateLimited,
                "rate_limited",
            ),
            (
                "API returned 401: private-account-data",
                LimitError::ClaudeAuthRejected,
                "auth_rejected",
            ),
            (
                "API returned 403: private-account-data",
                LimitError::ClaudeAuthRejected,
                "auth_rejected",
            ),
            (
                "API returned 500: private-account-data",
                LimitError::ClaudeServer,
                "server_error",
            ),
            (
                "API returned 503: private-account-data",
                LimitError::ClaudeServer,
                "server_error",
            ),
            (
                "API returned 404: not found private-account-data",
                LimitError::ClaudeApi,
                "api_error",
            ),
            (
                "API request failed: timeout private-account-data",
                LimitError::ClaudeNetwork,
                "network_error",
            ),
            (
                "API request failed: TLS private-account-data",
                LimitError::ClaudeNetwork,
                "network_error",
            ),
            (
                "no such host private-account-data",
                LimitError::ClaudeNetwork,
                "network_error",
            ),
            (
                "parsing response: missing field private-account-data",
                LimitError::ClaudeApi,
                "api_error",
            ),
            (
                "account 429 private-account-data",
                LimitError::ClaudeApi,
                "api_error",
            ),
            (
                "HTTP 4290 private-account-data",
                LimitError::ClaudeApi,
                "api_error",
            ),
        ] {
            let payload = json!({"snapshots": [{
                "provider_id": "claude_code", "metrics": {},
                "diagnostics": {"usage_api_error": diagnostic}
            }]});
            let result = parse_claude(payload.to_string().as_bytes());
            assert_eq!(result.as_ref().unwrap_err(), &expected, "{diagnostic}");
            let serialized = serde_json::to_string(&provider_result(
                result,
                "OpenUsage",
                LimitError::ClaudeData,
            ))
            .unwrap();
            assert!(serialized.contains(code));
            assert!(!serialized.contains("private-account-data"));
        }
    }

    #[test]
    fn cookie_failure_does_not_hide_oauth_authentication_error() {
        for (diagnostic, expected) in [
            (
                "cookie source not found; oauth: Claude Code OAuth token expired",
                LimitError::ClaudeAuthExpired,
            ),
            (
                "cookie source unsupported; oauth: no OAuth access token in private-path",
                LimitError::ClaudeAuthRequired,
            ),
            (
                "reading Claude Code credentials: The system cannot find the file specified",
                LimitError::ClaudeAuthRequired,
            ),
        ] {
            assert_eq!(classify_claude_error(&diagnostic.to_lowercase()), expected);
        }
    }

    #[test]
    #[ignore = "requires npm Codex installation, login and network"]
    fn live_quotas_from_npm_native_cli() {
        let prefix = PathBuf::from(std::env::var_os("APPDATA").unwrap()).join("npm");
        let exe = npm_codex(&prefix).expect("npm native Codex must be installed");
        let result = tauri::async_runtime::block_on(async {
            tokio::time::timeout(CODEX_TIMEOUT, codex_from_path(&exe)).await
        })
        .expect("npm Codex must respond within the deadline")
        .expect("npm Codex quota retrieval must succeed");
        assert!(result.0.is_some());
    }

    #[test]
    #[ignore = "requires installed Codex, Claude login and network; run alone with --test-threads=1"]
    fn live_quotas_without_codex_in_path() {
        let previous_path = std::env::var_os("PATH");
        let system = PathBuf::from(std::env::var_os("SYSTEMROOT").unwrap()).join("System32");
        std::env::set_var("PATH", system);
        let codex = tauri::async_runtime::block_on(codex_limits());
        match previous_path {
            Some(path) => std::env::set_var("PATH", path),
            None => std::env::remove_var("PATH"),
        }
        let claude = tauri::async_runtime::block_on(claude_limits(
            &PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/openusage.exe"),
        ));
        println!(
            "Codex: {}",
            serde_json::to_string(&provider_result(
                codex.clone(),
                "Codex app-server",
                LimitError::CodexData
            ))
            .unwrap()
        );
        println!(
            "Claude: {}",
            serde_json::to_string(&provider_result(
                claude.clone(),
                "OpenUsage",
                LimitError::ClaudeData
            ))
            .unwrap()
        );
        assert!(codex.unwrap().0.is_some());
        assert!(claude.unwrap().0.is_some());
    }
}
