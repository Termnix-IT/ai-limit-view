use serde::Serialize;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant};
use tauri::Manager;

const CODEX_TIMEOUT: Duration = Duration::from_secs(25);
const OPENUSAGE_TIMEOUT: Duration = Duration::from_secs(60);

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
    ClaudeAuthRequired,
    ClaudeApi,
    ClaudeData,
    Internal,
}

impl LimitError {
    fn code(self) -> &'static str {
        match self {
            Self::CodexNotFound => "codex_not_found",
            Self::OpenUsageNotFound => "openusage_not_found",
            Self::ClaudeAuthExpired => "auth_expired",
            Self::ClaudeAuthRequired | Self::CodexAccount => "auth_required",
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
            Self::ClaudeAuthExpired => "Claude Code の認証期限が切れています。Claude Code を起動し、必要なら /login でログインし直してから再読み込みしてください。",
            Self::ClaudeAuthRequired => "Claude Code の認証情報がありません。Claude Code で /login を実行してから再読み込みしてください。",
            Self::ClaudeApi => "Claude の利用枠 API に接続できません。Claude Code の /usage を確認し、時間をおいて再読み込みしてください。",
            Self::ClaudeData => "OpenUsage から Claude の利用枠が返りませんでした。Claude Code のログイン状態と契約を確認してください。",
            Self::Internal => "残量の取得処理に失敗しました。再読み込みしてください。",
        }
    }
}

type WindowsResult = Result<(Option<LimitWindow>, Option<LimitWindow>), LimitError>;

#[derive(Debug, Serialize)]
pub struct LiveLimits {
    codex: ProviderLimits,
    claude: ProviderLimits,
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
pub async fn get_live_limits(app: tauri::AppHandle) -> LiveLimits {
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
    tauri::async_runtime::spawn_blocking(move || {
        let codex = thread::spawn(codex_limits);
        let claude = thread::spawn(move || match openusage {
            Some(path) => claude_limits(&path),
            None => Err(LimitError::OpenUsageNotFound),
        });
        LiveLimits {
            codex: provider_result(
                codex.join().unwrap_or(Err(LimitError::Internal)),
                "Codex app-server",
                LimitError::CodexData,
            ),
            claude: provider_result(
                claude.join().unwrap_or(Err(LimitError::Internal)),
                "OpenUsage",
                LimitError::ClaudeData,
            ),
        }
    })
    .await
    .unwrap_or_else(|_| LiveLimits {
        codex: provider_result(
            Err(LimitError::Internal),
            "Codex app-server",
            LimitError::CodexData,
        ),
        claude: provider_result(
            Err(LimitError::Internal),
            "OpenUsage",
            LimitError::ClaudeData,
        ),
    })
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
    // Do not execute an older codex.cmd shim or search the current directory.
    search_path.and_then(|path| {
        std::env::split_paths(path)
            .filter(|dir| dir.is_absolute())
            .map(|dir| dir.join("codex.exe"))
            .find(|path| path.is_file())
    })
}

fn codex_limits() -> WindowsResult {
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let path = find_codex(local.as_deref(), std::env::var_os("PATH").as_deref())
        .ok_or(LimitError::CodexNotFound)?;
    let mut child = crate::process::background_command(path)
        .args(["app-server", "--stdio"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| LimitError::CodexStart)?;
    let stdout = child.stdout.take().ok_or(LimitError::CodexRead)?;
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    let deadline = Instant::now() + CODEX_TIMEOUT;
    let result = (|| {
        let stdin = child.stdin.as_mut().ok_or(LimitError::CodexRead)?;
        send_rpc(
            stdin,
            json!({"id": 1, "method": "initialize", "params": {
                "clientInfo": {"name": "limitview", "title": "LimitView", "version": env!("CARGO_PKG_VERSION")}
            }}),
        )?;
        read_rpc(&rx, 1, deadline)?;
        send_rpc(stdin, json!({"method": "initialized", "params": {}}))?;
        send_rpc(
            stdin,
            json!({"id": 2, "method": "account/rateLimits/read", "params": {}}),
        )?;
        parse_codex(&read_rpc(&rx, 2, deadline)?)
    })();
    stop_child(&mut child);
    result
}

fn send_rpc(stdin: &mut impl Write, value: Value) -> Result<(), LimitError> {
    writeln!(stdin, "{value}").map_err(|_| LimitError::CodexRead)?;
    stdin.flush().map_err(|_| LimitError::CodexRead)
}

fn read_rpc(
    rx: &Receiver<std::io::Result<String>>,
    id: i64,
    deadline: Instant,
) -> Result<Value, LimitError> {
    loop {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .ok_or(LimitError::CodexTimeout)?;
        let line = rx
            .recv_timeout(remaining)
            .map_err(|error| match error {
                mpsc::RecvTimeoutError::Timeout => LimitError::CodexTimeout,
                mpsc::RecvTimeoutError::Disconnected => LimitError::CodexRead,
            })?
            .map_err(|_| LimitError::CodexRead)?;
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

fn claude_limits(path: &Path) -> WindowsResult {
    let output = run_with_timeout(
        path,
        &["export", "--output", "-", "--source", "direct"],
        OPENUSAGE_TIMEOUT,
    )?;
    parse_claude(&output)
}

fn parse_claude(output: &[u8]) -> WindowsResult {
    let payload: Value = serde_json::from_slice(output).map_err(|_| LimitError::ClaudeData)?;
    let snapshot = payload
        .get("snapshots")
        .and_then(Value::as_array)
        .and_then(|rows| {
            rows.iter()
                .find(|row| row.get("provider_id").and_then(Value::as_str) == Some("claude_code"))
        })
        .ok_or(LimitError::ClaudeData)?;
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
        return Err(if diagnostic.contains("token expired") {
            LimitError::ClaudeAuthExpired
        } else if diagnostic.contains("no oauth")
            || diagnostic.contains("no credentials")
            || diagnostic.contains("not found")
            || diagnostic.contains("missing")
        {
            LimitError::ClaudeAuthRequired
        } else if !diagnostic.is_empty() {
            LimitError::ClaudeApi
        } else {
            LimitError::ClaudeData
        });
    }
    Ok(result)
}

fn run_with_timeout(path: &Path, args: &[&str], timeout: Duration) -> Result<Vec<u8>, LimitError> {
    let mut child = crate::process::background_command(path)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| LimitError::OpenUsageRun)?;
    let stdout = child.stdout.take().ok_or(LimitError::OpenUsageRun)?;
    let reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take(4 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let deadline = Instant::now() + timeout;
    let success = loop {
        let status = match child.try_wait() {
            Ok(status) => status,
            Err(_) => {
                stop_child(&mut child);
                return Err(LimitError::OpenUsageRun);
            }
        };
        if let Some(status) = status {
            break status.success();
        }
        if Instant::now() >= deadline {
            stop_child(&mut child);
            return Err(LimitError::OpenUsageTimeout);
        }
        thread::sleep(Duration::from_millis(50));
    };
    let output = reader
        .join()
        .map_err(|_| LimitError::OpenUsageRun)?
        .map_err(|_| LimitError::OpenUsageRun)?;
    if success && output.len() <= 4 * 1024 * 1024 {
        Ok(output)
    } else {
        Err(LimitError::OpenUsageRun)
    }
}

fn stop_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(result.unwrap_err(), LimitError::ClaudeApi);
        assert!(!LimitError::ClaudeApi
            .message()
            .contains("private-account-data"));
        let provider = provider_result(Ok((None, None)), "Codex app-server", LimitError::CodexData);
        assert!(provider.five_hour.is_none());
        assert_eq!(provider.status, "unavailable");
    }

    #[test]
    #[ignore = "requires installed Codex, Claude login and network; run alone with --test-threads=1"]
    fn live_quotas_without_codex_in_path() {
        let previous_path = std::env::var_os("PATH");
        let system = PathBuf::from(std::env::var_os("SYSTEMROOT").unwrap()).join("System32");
        std::env::set_var("PATH", system);
        let codex = codex_limits();
        match previous_path {
            Some(path) => std::env::set_var("PATH", path),
            None => std::env::remove_var("PATH"),
        }
        let claude = claude_limits(
            &PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/openusage.exe"),
        );
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
