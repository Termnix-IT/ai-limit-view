use chrono::{DateTime, Duration, NaiveDateTime, Utc, Weekday};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri::{Manager, State};

const OPENAI_USAGE_URL: &str = "https://platform.openai.com/usage";
const CLAUDE_USAGE_URL: &str =
    "https://support.anthropic.com/en/articles/12157520-claude-code-usage-analytics";
const AUTO_MONITOR_NOTE: &str = "Auto process monitor";

pub struct AppState {
    conn: Mutex<Connection>,
    database_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolKind {
    Codex,
    ClaudeCode,
}

impl ToolKind {
    fn as_str(&self) -> &'static str {
        match self {
            ToolKind::Codex => "codex",
            ToolKind::ClaudeCode => "claude_code",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    Manual,
    StatusPaste,
    LogImport,
    Estimated,
}

impl SourceKind {
    fn as_str(&self) -> &'static str {
        match self {
            SourceKind::Manual => "manual",
            SourceKind::StatusPaste => "status_paste",
            SourceKind::LogImport => "log_import",
            SourceKind::Estimated => "estimated",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSessionInput {
    tool: ToolKind,
    started_at: String,
    ended_at: Option<String>,
    duration_minutes: i64,
    source: SourceKind,
    confidence: f64,
    note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusSnapshotInput {
    tool: ToolKind,
    captured_at: String,
    raw_text: String,
    summary_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualLimitEntryInput {
    tool: ToolKind,
    captured_at: String,
    scope: Option<String>,
    remaining_label: String,
    remaining_percent: Option<f64>,
    reset_at: Option<String>,
    note: Option<String>,
    confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageLogFilter {
    tool: Option<ToolKind>,
    start_date: Option<String>,
    end_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingInput {
    key: String,
    value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSession {
    id: i64,
    tool: String,
    started_at: String,
    ended_at: Option<String>,
    duration_minutes: i64,
    source: String,
    confidence: f64,
    note: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualLimitSummary {
    scope: String,
    remaining_label: String,
    remaining_percent: Option<f64>,
    reset_at: Option<String>,
    captured_at: String,
    confidence: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDashboard {
    tool: String,
    label: String,
    launch_count_today: i64,
    estimated_minutes_today: i64,
    estimated_minutes_window: i64,
    window_minutes: i64,
    last_used_at: Option<String>,
    latest_status_summary: Option<String>,
    status_saved: bool,
    latest_manual_remaining: Option<String>,
    manual_limits: Vec<ManualLimitSummary>,
    attention_level: String,
    official_usage_url: String,
    is_running: bool,
    active_session_started_at: Option<String>,
    estimated_session_reset_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quota_session_used: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quota_session_limit: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quota_session_reset_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quota_session_window_minutes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quota_session_started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quota_burn_rate_tokens_per_min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quota_projected_depletion_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quota_plan: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    date: String,
    tools: Vec<ToolDashboard>,
    recent_logs: Vec<UsageSession>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    values: HashMap<String, String>,
    database_path: String,
    official_urls: HashMap<String, String>,
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&app_dir)?;
            let database_path = app_dir.join("ai-limitusage-watcher.db");
            let conn = Connection::open(&database_path)?;
            migrate(&conn)?;
            app.manage(AppState {
                conn: Mutex::new(conn),
                database_path,
            });

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_background_color(Some(tauri::webview::Color(0, 0, 0, 0)));
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_dashboard,
            list_usage_logs,
            create_usage_session,
            update_usage_session,
            delete_usage_session,
            save_status_snapshot,
            save_manual_limit_entry,
            get_settings,
            update_settings,
            scan_process_usage,
            open_official_usage_url
        ])
        .run(tauri::generate_context!())
        .expect("failed to run AI LimitUsage Watcher");
}

pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS usage_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tool TEXT NOT NULL CHECK(tool IN ('codex', 'claude_code')),
            started_at TEXT NOT NULL,
            ended_at TEXT,
            duration_minutes INTEGER NOT NULL CHECK(duration_minutes >= 0),
            source TEXT NOT NULL CHECK(source IN ('manual', 'status_paste', 'log_import', 'estimated')),
            confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
            note TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS status_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tool TEXT NOT NULL CHECK(tool IN ('codex', 'claude_code')),
            captured_at TEXT NOT NULL,
            raw_text TEXT NOT NULL,
            summary_text TEXT,
            source TEXT NOT NULL CHECK(source IN ('status_paste', 'manual')),
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS manual_limit_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tool TEXT NOT NULL CHECK(tool IN ('codex', 'claude_code')),
            captured_at TEXT NOT NULL,
            scope TEXT NOT NULL DEFAULT 'manual',
            remaining_label TEXT NOT NULL,
            remaining_percent REAL,
            reset_at TEXT,
            note TEXT,
            confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#,
    )?;

    add_column_if_missing(
        conn,
        "manual_limit_entries",
        "scope",
        "TEXT NOT NULL DEFAULT 'manual'",
    )?;
    add_column_if_missing(conn, "manual_limit_entries", "remaining_percent", "REAL")?;

    let now = now_string();
    for (key, value) in [
        ("medium_minutes", "120"),
        ("high_minutes", "240"),
        ("codex_medium_minutes", "120"),
        ("codex_high_minutes", "240"),
        ("codex_hour_window_minutes", "300"),
        ("codex_hour_high_minutes", "60"),
        ("claude_code_medium_minutes", "120"),
        ("claude_code_high_minutes", "360"),
        ("claude_code_hour_window_minutes", "10080"),
        ("claude_code_hour_high_minutes", "360"),
        ("medium_launches", "5"),
        ("high_launches", "10"),
        ("process_monitor_enabled", "1"),
        ("codex_process_names", "codex.exe,codex"),
        (
            "claude_code_process_names",
            "claude.exe,claude-code.exe,claude",
        ),
        ("claude_code_session_window_minutes", "300"),
        ("claude_code_session_message_limit", "45"),
        ("claude_code_weekly_window_minutes", "10080"),
        ("claude_code_weekly_message_limit", "200"),
        ("claude_code_weekly_reset_weekday", "wednesday"),
        ("claude_code_weekly_reset_hour", "18"),
        ("claude_code_session_token_limit", "70000000"),
        ("claude_code_weekly_token_limit", "750000000"),
        ("claude_code_plan", "pro"),
        ("claude_code_burn_window_minutes", "30"),
    ] {
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
            params![key, value, now],
        )?;
    }

    migrate_claude_code_defaults(conn, &now)?;

    Ok(())
}

#[tauri::command]
fn get_dashboard(date: String, state: State<AppState>) -> Result<Dashboard, String> {
    let conn = state.conn.lock().map_err(|err| err.to_string())?;
    dashboard_for_date(&conn, &date).map_err(|err| err.to_string())
}

#[tauri::command]
fn list_usage_logs(
    filter: Option<UsageLogFilter>,
    state: State<AppState>,
) -> Result<Vec<UsageSession>, String> {
    let conn = state.conn.lock().map_err(|err| err.to_string())?;
    list_usage_logs_impl(&conn, filter).map_err(|err| err.to_string())
}

#[tauri::command]
fn create_usage_session(input: UsageSessionInput, state: State<AppState>) -> Result<i64, String> {
    validate_session_input(&input)?;
    let conn = state.conn.lock().map_err(|err| err.to_string())?;
    create_usage_session_impl(&conn, input).map_err(|err| err.to_string())
}

#[tauri::command]
fn update_usage_session(
    id: i64,
    input: UsageSessionInput,
    state: State<AppState>,
) -> Result<(), String> {
    validate_session_input(&input)?;
    let conn = state.conn.lock().map_err(|err| err.to_string())?;
    conn.execute(
        "UPDATE usage_sessions
         SET tool = ?1, started_at = ?2, ended_at = ?3, duration_minutes = ?4, source = ?5,
             confidence = ?6, note = ?7, updated_at = ?8
         WHERE id = ?9",
        params![
            input.tool.as_str(),
            input.started_at,
            input.ended_at,
            input.duration_minutes,
            input.source.as_str(),
            input.confidence,
            input.note,
            now_string(),
            id
        ],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_usage_session(id: i64, state: State<AppState>) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|err| err.to_string())?;
    conn.execute("DELETE FROM usage_sessions WHERE id = ?1", params![id])
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_status_snapshot(input: StatusSnapshotInput, state: State<AppState>) -> Result<i64, String> {
    if input.raw_text.trim().is_empty() {
        return Err("raw_text is required".to_string());
    }
    let conn = state.conn.lock().map_err(|err| err.to_string())?;
    conn.execute(
        "INSERT INTO status_snapshots (tool, captured_at, raw_text, summary_text, source, created_at)
         VALUES (?1, ?2, ?3, ?4, 'status_paste', ?5)",
        params![
            input.tool.as_str(),
            input.captured_at,
            input.raw_text,
            input.summary_text,
            now_string()
        ],
    )
    .map_err(|err| err.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
fn save_manual_limit_entry(
    input: ManualLimitEntryInput,
    state: State<AppState>,
) -> Result<i64, String> {
    if input.remaining_label.trim().is_empty() {
        return Err("remaining_label is required".to_string());
    }
    if let Some(percent) = input.remaining_percent {
        if !(0.0..=100.0).contains(&percent) {
            return Err("remaining_percent must be between 0 and 100".to_string());
        }
    }
    if !(0.0..=1.0).contains(&input.confidence) {
        return Err("confidence must be between 0 and 1".to_string());
    }
    let scope = input.scope.unwrap_or_else(|| "manual".to_string());
    if !matches!(scope.as_str(), "manual" | "session_5h" | "weekly") {
        return Err(format!("unsupported limit scope: {scope}"));
    }
    let conn = state.conn.lock().map_err(|err| err.to_string())?;
    conn.execute(
        "INSERT INTO manual_limit_entries (tool, captured_at, scope, remaining_label, remaining_percent, reset_at, note, confidence, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            input.tool.as_str(),
            input.captured_at,
            scope,
            input.remaining_label,
            input.remaining_percent,
            input.reset_at,
            input.note,
            input.confidence,
            now_string()
        ],
    )
    .map_err(|err| err.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Result<SettingsView, String> {
    let conn = state.conn.lock().map_err(|err| err.to_string())?;
    settings_view(&conn, state.database_path.clone()).map_err(|err| err.to_string())
}

#[tauri::command]
fn update_settings(entries: Vec<SettingInput>, state: State<AppState>) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|err| err.to_string())?;
    let now = now_string();
    for entry in entries {
        if !matches!(
            entry.key.as_str(),
            "medium_minutes"
                | "high_minutes"
                | "codex_medium_minutes"
                | "codex_high_minutes"
                | "codex_hour_window_minutes"
                | "codex_hour_high_minutes"
                | "claude_code_medium_minutes"
                | "claude_code_high_minutes"
                | "claude_code_hour_window_minutes"
                | "claude_code_hour_high_minutes"
                | "claude_code_session_window_minutes"
                | "claude_code_session_message_limit"
                | "claude_code_session_token_limit"
                | "claude_code_weekly_window_minutes"
                | "claude_code_weekly_message_limit"
                | "claude_code_weekly_token_limit"
                | "claude_code_weekly_reset_weekday"
                | "claude_code_weekly_reset_hour"
                | "claude_code_plan"
                | "claude_code_burn_window_minutes"
                | "medium_launches"
                | "high_launches"
                | "process_monitor_enabled"
                | "codex_process_names"
                | "claude_code_process_names"
        ) {
            return Err(format!("unsupported setting key: {}", entry.key));
        }
        if entry.key == "claude_code_weekly_reset_weekday" {
            if parse_weekday(&entry.value).is_none() {
                return Err(format!("invalid weekday: {}", entry.value));
            }
        }
        if entry.key == "claude_code_weekly_reset_hour" {
            let hour = entry
                .value
                .parse::<i64>()
                .map_err(|_| format!("setting must be an integer: {}", entry.key))?;
            if !(0..=23).contains(&hour) {
                return Err("reset hour must be between 0 and 23".to_string());
            }
        }
        if entry.key == "claude_code_plan" {
            if plan_token_limit(&entry.value).is_none() && entry.value != "custom" {
                return Err(format!("invalid plan: {}", entry.value));
            }
        }
        if matches!(
            entry.key.as_str(),
            "medium_minutes"
                | "high_minutes"
                | "codex_medium_minutes"
                | "codex_high_minutes"
                | "codex_hour_window_minutes"
                | "codex_hour_high_minutes"
                | "claude_code_medium_minutes"
                | "claude_code_high_minutes"
                | "claude_code_hour_window_minutes"
                | "claude_code_hour_high_minutes"
                | "claude_code_session_window_minutes"
                | "claude_code_session_message_limit"
                | "claude_code_session_token_limit"
                | "claude_code_weekly_window_minutes"
                | "claude_code_weekly_message_limit"
                | "claude_code_weekly_token_limit"
                | "claude_code_burn_window_minutes"
                | "medium_launches"
                | "high_launches"
                | "process_monitor_enabled"
        ) {
            let value = entry
                .value
                .parse::<i64>()
                .map_err(|_| format!("setting must be an integer: {}", entry.key))?;
            if value < 0 {
                return Err(format!("setting must be positive: {}", entry.key));
            }
        }
        conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![entry.key, entry.value, now],
        )
        .map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn scan_process_usage(state: State<AppState>) -> Result<(), String> {
    let process_names = running_process_names()?;
    let conn = state.conn.lock().map_err(|err| err.to_string())?;
    scan_process_usage_impl(&conn, &process_names).map_err(|err| err.to_string())
}

#[tauri::command]
fn open_official_usage_url(tool: ToolKind) -> Result<(), String> {
    open::that(official_url(&tool)).map_err(|err| err.to_string())
}

fn dashboard_for_date(conn: &Connection, date: &str) -> rusqlite::Result<Dashboard> {
    let settings = read_settings(conn)?;
    let tools = vec![
        tool_dashboard(conn, ToolKind::Codex, "Codex", date, &settings, None)?,
        tool_dashboard(
            conn,
            ToolKind::ClaudeCode,
            "Claude Code",
            date,
            &settings,
            None,
        )?,
    ];
    let recent_logs = list_usage_logs_impl(conn, None)?;
    Ok(Dashboard {
        date: date.to_string(),
        tools,
        recent_logs: recent_logs.into_iter().take(8).collect(),
    })
}

fn tool_dashboard(
    conn: &Connection,
    tool: ToolKind,
    label: &str,
    date: &str,
    settings: &HashMap<String, String>,
    claude_code_activity: Option<&ClaudeCodeActivity>,
) -> rusqlite::Result<ToolDashboard> {
    let tool_key = tool.as_str();
    let (launch_count_today, estimated_minutes_for_today): (i64, i64) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(duration_minutes), 0)
         FROM usage_sessions
         WHERE tool = ?1 AND substr(started_at, 1, 10) = ?2",
        params![tool_key, date],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let last_used_at: Option<String> = conn
        .query_row(
            "SELECT started_at FROM usage_sessions WHERE tool = ?1 ORDER BY started_at DESC LIMIT 1",
            params![tool_key],
            |row| row.get(0),
        )
        .optional()?;
    let window_minutes = setting_i64(settings, &format!("{tool_key}_hour_window_minutes"), 300);
    let estimated_minutes_window = rolling_window_minutes(conn, tool_key, window_minutes)?;
    let estimated_minutes_today = if matches!(tool, ToolKind::ClaudeCode) {
        estimated_minutes_window
    } else {
        estimated_minutes_for_today
    };
    let latest_status_summary: Option<String> = conn
        .query_row(
            "SELECT COALESCE(summary_text, raw_text) FROM status_snapshots
             WHERE tool = ?1 ORDER BY captured_at DESC, id DESC LIMIT 1",
            params![tool_key],
            |row| row.get(0),
        )
        .optional()?;
    let latest_manual_remaining: Option<String> = conn
        .query_row(
            "SELECT remaining_label FROM manual_limit_entries
             WHERE tool = ?1 ORDER BY captured_at DESC, id DESC LIMIT 1",
            params![tool_key],
            |row| row.get(0),
        )
        .optional()?;
    let manual_limits = latest_manual_limits(conn, tool_key)?;
    let active_session_started_at: Option<String> = conn
        .query_row(
            "SELECT started_at FROM usage_sessions
             WHERE tool = ?1 AND source = 'estimated' AND ended_at IS NULL AND note = ?2
             ORDER BY started_at DESC LIMIT 1",
            params![tool_key, AUTO_MONITOR_NOTE],
            |row| row.get(0),
        )
        .optional()?;
    let estimated_session_reset_at = if matches!(tool, ToolKind::ClaudeCode) {
        latest_session_reset_at(
            conn,
            tool_key,
            setting_i64(settings, "claude_code_session_window_minutes", 300).max(1),
        )?
    } else {
        None
    };

    let (
        quota_session_used,
        quota_session_limit,
        quota_session_reset_at,
        quota_session_window_minutes,
        quota_session_started_at,
        quota_burn_rate_tokens_per_min,
        quota_projected_depletion_at,
        quota_plan,
    ) = if matches!(tool, ToolKind::ClaudeCode) {
        let default_activity = ClaudeCodeActivity::default();
        let activity = claude_code_activity.unwrap_or(&default_activity);
        let session_window =
            setting_i64(settings, "claude_code_session_window_minutes", 300).max(1);
        let burn_window = setting_i64(settings, "claude_code_burn_window_minutes", 30).max(1);
        let plan_value = settings
            .get("claude_code_plan")
            .cloned()
            .unwrap_or_else(|| "pro".to_string());
        let session_limit = match plan_token_limit(&plan_value) {
            Some(v) => v,
            None => setting_i64(settings, "claude_code_session_token_limit", 70_000_000),
        };
        let now = Utc::now();
        let quota =
            compute_claude_code_quota(activity, now, session_window, session_limit, burn_window);
        (
            Some(quota.session_used),
            Some(session_limit),
            quota.session_reset_at,
            Some(session_window),
            quota.session_started_at,
            Some(quota.burn_rate_tokens_per_min),
            quota.projected_depletion_at,
            Some(plan_value),
        )
    } else {
        (None, None, None, None, None, None, None, None)
    };

    Ok(ToolDashboard {
        tool: tool_key.to_string(),
        label: label.to_string(),
        launch_count_today,
        estimated_minutes_today,
        estimated_minutes_window,
        window_minutes,
        last_used_at,
        latest_status_summary: latest_status_summary.clone(),
        status_saved: latest_status_summary.is_some(),
        latest_manual_remaining,
        manual_limits,
        attention_level: attention_level(
            tool_key,
            estimated_minutes_today,
            launch_count_today,
            settings,
        ),
        official_usage_url: official_url(&tool).to_string(),
        is_running: active_session_started_at.is_some(),
        active_session_started_at,
        estimated_session_reset_at,
        quota_session_used,
        quota_session_limit,
        quota_session_reset_at,
        quota_session_window_minutes,
        quota_session_started_at,
        quota_burn_rate_tokens_per_min,
        quota_projected_depletion_at,
        quota_plan,
    })
}

#[derive(Debug, Clone)]
struct ClaudeCodeQuota {
    session_used: i64,
    session_started_at: Option<String>,
    session_reset_at: Option<String>,
    burn_rate_tokens_per_min: f64,
    projected_depletion_at: Option<String>,
}

fn plan_token_limit(plan: &str) -> Option<i64> {
    // Rough Pro-tier baseline calibrated against an observed 29% session = 20.26M tokens.
    // Max tiers scale the baseline linearly.
    match plan.trim().to_ascii_lowercase().as_str() {
        "pro" => Some(70_000_000),
        "max5" | "max_5" | "max 5x" | "max-5" => Some(350_000_000),
        "max20" | "max_20" | "max 20x" | "max-20" => Some(1_400_000_000),
        _ => None,
    }
}

#[derive(Debug, Clone, Copy)]
struct TokenEvent {
    timestamp: DateTime<Utc>,
    tokens: i64,
}

#[derive(Debug, Default, Clone)]
struct ClaudeCodeActivity {
    prompts: Vec<DateTime<Utc>>,
    token_events: Vec<TokenEvent>,
}

fn compute_claude_code_quota(
    activity: &ClaudeCodeActivity,
    now: DateTime<Utc>,
    session_window_minutes: i64,
    session_limit: i64,
    burn_window_minutes: i64,
) -> ClaudeCodeQuota {
    let session_window = Duration::minutes(session_window_minutes.max(1));

    let mut sorted_prompts = activity.prompts.clone();
    sorted_prompts.sort();

    let mut current_window_start: Option<DateTime<Utc>> = None;
    for ts in &sorted_prompts {
        match current_window_start {
            Some(start) if *ts < start + session_window => {}
            _ => current_window_start = Some(*ts),
        }
    }

    let (session_used, session_started_at, session_reset_at) = match current_window_start {
        Some(start) => {
            let end = start + session_window;
            if now < end {
                let used: i64 = activity
                    .token_events
                    .iter()
                    .filter(|ev| ev.timestamp >= start && ev.timestamp < end)
                    .map(|ev| ev.tokens)
                    .sum();
                (used, Some(start.to_rfc3339()), Some(end.to_rfc3339()))
            } else {
                (0, None, None)
            }
        }
        None => (0, None, None),
    };

    let burn_window = Duration::minutes(burn_window_minutes.max(1));
    let burn_cutoff = now - burn_window;
    let session_lower_bound = current_window_start.unwrap_or(burn_cutoff);
    let burn_start = burn_cutoff.max(session_lower_bound);
    let burn_tokens: i64 = if now > burn_start {
        activity
            .token_events
            .iter()
            .filter(|ev| ev.timestamp >= burn_start && ev.timestamp <= now)
            .map(|ev| ev.tokens)
            .sum()
    } else {
        0
    };
    let burn_minutes = now.signed_duration_since(burn_start).num_seconds() as f64 / 60.0;
    let burn_rate_tokens_per_min = if burn_minutes > 0.0 {
        burn_tokens as f64 / burn_minutes
    } else {
        0.0
    };

    let projected_depletion_at = if burn_rate_tokens_per_min > 0.0
        && session_limit > 0
        && session_used < session_limit
        && current_window_start.is_some()
    {
        let remaining = (session_limit - session_used) as f64;
        let minutes_to_depletion = remaining / burn_rate_tokens_per_min;
        let depletion = now + Duration::seconds((minutes_to_depletion * 60.0) as i64);
        // Cap depletion to session reset moment if it would otherwise fall after it.
        let reset = current_window_start.unwrap() + session_window;
        Some(depletion.min(reset).to_rfc3339())
    } else {
        None
    };

    ClaudeCodeQuota {
        session_used,
        session_started_at,
        session_reset_at,
        burn_rate_tokens_per_min,
        projected_depletion_at,
    }
}

fn parse_weekday(value: &str) -> Option<Weekday> {
    match value.trim().to_ascii_lowercase().as_str() {
        "monday" | "mon" | "1" => Some(Weekday::Mon),
        "tuesday" | "tue" | "tues" | "2" => Some(Weekday::Tue),
        "wednesday" | "wed" | "3" => Some(Weekday::Wed),
        "thursday" | "thu" | "thur" | "thurs" | "4" => Some(Weekday::Thu),
        "friday" | "fri" | "5" => Some(Weekday::Fri),
        "saturday" | "sat" | "6" => Some(Weekday::Sat),
        "sunday" | "sun" | "7" | "0" => Some(Weekday::Sun),
        _ => None,
    }
}

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if !columns.iter().any(|name| name == column) {
        conn.execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
            [],
        )?;
    }
    Ok(())
}

fn create_usage_session_impl(conn: &Connection, input: UsageSessionInput) -> rusqlite::Result<i64> {
    let now = now_string();
    conn.execute(
        "INSERT INTO usage_sessions
         (tool, started_at, ended_at, duration_minutes, source, confidence, note, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
        params![
            input.tool.as_str(),
            input.started_at,
            input.ended_at,
            input.duration_minutes,
            input.source.as_str(),
            input.confidence,
            input.note,
            now
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

fn latest_manual_limits(
    conn: &Connection,
    tool: &str,
) -> rusqlite::Result<Vec<ManualLimitSummary>> {
    let mut stmt = conn.prepare(
        "SELECT scope, remaining_label, remaining_percent, reset_at, captured_at, confidence
         FROM manual_limit_entries
         WHERE tool = ?1
         ORDER BY captured_at DESC, id DESC
         LIMIT 20",
    )?;
    let mut rows = stmt.query(params![tool])?;
    let mut seen = Vec::<String>::new();
    let mut limits = Vec::new();
    while let Some(row) = rows.next()? {
        let scope: String = row.get(0)?;
        if seen.iter().any(|value| value == &scope) {
            continue;
        }
        seen.push(scope.clone());
        limits.push(ManualLimitSummary {
            scope,
            remaining_label: row.get(1)?,
            remaining_percent: row.get(2)?,
            reset_at: row.get(3)?,
            captured_at: row.get(4)?,
            confidence: row.get(5)?,
        });
    }
    Ok(limits)
}

fn latest_session_reset_at(
    conn: &Connection,
    tool: &str,
    session_window_minutes: i64,
) -> rusqlite::Result<Option<String>> {
    let started_at: Option<String> = conn
        .query_row(
            "SELECT started_at FROM usage_sessions
             WHERE tool = ?1
             ORDER BY started_at DESC, id DESC LIMIT 1",
            params![tool],
            |row| row.get(0),
        )
        .optional()?;
    Ok(started_at
        .as_deref()
        .and_then(parse_datetime)
        .map(|started| (started + Duration::minutes(session_window_minutes.max(1))).to_rfc3339()))
}

fn migrate_claude_code_defaults(conn: &Connection, now: &str) -> rusqlite::Result<()> {
    for (key, old_value, new_value) in [
        ("claude_code_high_minutes", "240", "360"),
        ("claude_code_hour_window_minutes", "300", "10080"),
        ("claude_code_hour_high_minutes", "60", "360"),
    ] {
        conn.execute(
            "UPDATE settings SET value = ?1, updated_at = ?2 WHERE key = ?3 AND value = ?4",
            params![new_value, now, key, old_value],
        )?;
    }
    Ok(())
}

fn list_usage_logs_impl(
    conn: &Connection,
    filter: Option<UsageLogFilter>,
) -> rusqlite::Result<Vec<UsageSession>> {
    let mut sql = String::from(
        "SELECT id, tool, started_at, ended_at, duration_minutes, source, confidence, note, created_at, updated_at
         FROM usage_sessions",
    );
    let filter = filter.unwrap_or(UsageLogFilter {
        tool: None,
        start_date: None,
        end_date: None,
    });

    let mut clauses = Vec::new();
    let mut values = Vec::new();
    if let Some(tool) = filter.tool {
        clauses.push("tool = ?");
        values.push(tool.as_str().to_string());
    }
    if let Some(start_date) = filter.start_date {
        clauses.push("substr(started_at, 1, 10) >= ?");
        values.push(start_date);
    }
    if let Some(end_date) = filter.end_date {
        clauses.push("substr(started_at, 1, 10) <= ?");
        values.push(end_date);
    }
    if !clauses.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&clauses.join(" AND "));
    }
    sql.push_str(" ORDER BY started_at DESC, id DESC LIMIT 200");

    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(rusqlite::params_from_iter(values))?;

    let mut logs = Vec::new();
    while let Some(row) = rows.next()? {
        logs.push(UsageSession {
            id: row.get(0)?,
            tool: row.get(1)?,
            started_at: row.get(2)?,
            ended_at: row.get(3)?,
            duration_minutes: row.get(4)?,
            source: row.get(5)?,
            confidence: row.get(6)?,
            note: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        });
    }
    Ok(logs)
}

fn settings_view(conn: &Connection, database_path: PathBuf) -> rusqlite::Result<SettingsView> {
    let values = read_settings(conn)?;
    let official_urls = HashMap::from([
        ("codex".to_string(), OPENAI_USAGE_URL.to_string()),
        ("claude_code".to_string(), CLAUDE_USAGE_URL.to_string()),
    ]);
    Ok(SettingsView {
        values,
        database_path: database_path.display().to_string(),
        official_urls,
    })
}

fn rolling_window_minutes(
    conn: &Connection,
    tool: &str,
    window_minutes: i64,
) -> rusqlite::Result<i64> {
    let now = Utc::now();
    let window_start = now - Duration::minutes(window_minutes.max(1));
    let mut stmt = conn.prepare(
        "SELECT started_at, ended_at, duration_minutes FROM usage_sessions
         WHERE tool = ?1 ORDER BY started_at DESC LIMIT 500",
    )?;
    let rows = stmt.query_map(params![tool], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, i64>(2)?,
        ))
    })?;

    let mut total = 0;
    for row in rows {
        let (started_at, ended_at, duration_minutes) = row?;
        let Some(started) = parse_datetime(&started_at) else {
            continue;
        };
        let ended = ended_at
            .as_deref()
            .and_then(parse_datetime)
            .unwrap_or_else(|| started + Duration::minutes(duration_minutes.max(0)));
        let overlap_start = started.max(window_start);
        let overlap_end = ended.min(now);
        if overlap_end > overlap_start {
            total += overlap_end
                .signed_duration_since(overlap_start)
                .num_minutes()
                .max(0);
        }
    }
    Ok(total)
}

fn scan_process_usage_impl(conn: &Connection, process_names: &[String]) -> rusqlite::Result<()> {
    let settings = read_settings(conn)?;
    if setting_i64(&settings, "process_monitor_enabled", 1) == 0 {
        close_all_auto_sessions(conn)?;
        return Ok(());
    }

    update_tool_process_state(
        conn,
        ToolKind::Codex,
        process_matches(
            process_names,
            setting_list(&settings, "codex_process_names", "codex.exe,codex"),
        ),
    )?;
    update_tool_process_state(
        conn,
        ToolKind::ClaudeCode,
        process_matches(
            process_names,
            setting_list(
                &settings,
                "claude_code_process_names",
                "claude.exe,claude-code.exe,claude",
            ),
        ),
    )?;
    Ok(())
}

fn update_tool_process_state(
    conn: &Connection,
    tool: ToolKind,
    is_running: bool,
) -> rusqlite::Result<()> {
    let tool_key = tool.as_str();
    let active: Option<(i64, String)> = conn
        .query_row(
            "SELECT id, started_at FROM usage_sessions
             WHERE tool = ?1 AND source = 'estimated' AND ended_at IS NULL AND note = ?2
             ORDER BY started_at DESC LIMIT 1",
            params![tool_key, AUTO_MONITOR_NOTE],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    match (is_running, active) {
        (true, Some((id, started_at))) => {
            let minutes = elapsed_minutes(&started_at);
            conn.execute(
                "UPDATE usage_sessions SET duration_minutes = ?1, updated_at = ?2 WHERE id = ?3",
                params![minutes, now_string(), id],
            )?;
        }
        (true, None) => {
            let now = now_string();
            conn.execute(
                "INSERT INTO usage_sessions
                 (tool, started_at, ended_at, duration_minutes, source, confidence, note, created_at, updated_at)
                 VALUES (?1, ?2, NULL, 0, 'estimated', 0.6, ?3, ?2, ?2)",
                params![tool_key, now, AUTO_MONITOR_NOTE],
            )?;
        }
        (false, Some((id, started_at))) => {
            let now = now_string();
            let minutes = elapsed_minutes(&started_at);
            conn.execute(
                "UPDATE usage_sessions SET ended_at = ?1, duration_minutes = ?2, updated_at = ?1 WHERE id = ?3",
                params![now, minutes, id],
            )?;
        }
        (false, None) => {}
    }
    Ok(())
}

fn close_all_auto_sessions(conn: &Connection) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(
        "SELECT id, started_at FROM usage_sessions
         WHERE source = 'estimated' AND ended_at IS NULL AND note = ?1",
    )?;
    let sessions = stmt
        .query_map(params![AUTO_MONITOR_NOTE], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (id, started_at) in sessions {
        let now = now_string();
        conn.execute(
            "UPDATE usage_sessions SET ended_at = ?1, duration_minutes = ?2, updated_at = ?1 WHERE id = ?3",
            params![now, elapsed_minutes(&started_at), id],
        )?;
    }
    Ok(())
}

fn running_process_names() -> Result<Vec<String>, String> {
    let output = Command::new("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .output()
        .map_err(|err| err.to_string())?;
    if !output.status.success() {
        return Err("failed to run tasklist".to_string());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    Ok(text
        .lines()
        .filter_map(|line| line.split(',').next())
        .map(|name| name.trim_matches('"').trim().to_ascii_lowercase())
        .filter(|name| !name.is_empty())
        .collect())
}

fn process_matches(process_names: &[String], watched_names: Vec<String>) -> bool {
    watched_names.iter().any(|watched| {
        let watched = watched.to_ascii_lowercase();
        process_names.iter().any(|name| {
            let base = name.strip_suffix(".exe").unwrap_or(name);
            let watched_base = watched.strip_suffix(".exe").unwrap_or(&watched);
            name == &watched || base == watched || name == watched_base || base == watched_base
        })
    })
}

fn setting_list(settings: &HashMap<String, String>, key: &str, default: &str) -> Vec<String> {
    settings
        .get(key)
        .map_or(default, String::as_str)
        .split(',')
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .collect()
}

fn read_settings(conn: &Connection) -> rusqlite::Result<HashMap<String, String>> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let mut rows = stmt.query([])?;
    let mut settings = HashMap::new();
    while let Some(row) = rows.next()? {
        settings.insert(row.get(0)?, row.get(1)?);
    }
    Ok(settings)
}

fn attention_level(
    tool: &str,
    minutes: i64,
    launches: i64,
    settings: &HashMap<String, String>,
) -> String {
    let medium_minutes = setting_i64(
        settings,
        &format!("{tool}_medium_minutes"),
        setting_i64(settings, "medium_minutes", 120),
    );
    let high_minutes = setting_i64(
        settings,
        &format!("{tool}_high_minutes"),
        setting_i64(settings, "high_minutes", 240),
    );
    let medium_launches = setting_i64(settings, "medium_launches", 5);
    let high_launches = setting_i64(settings, "high_launches", 10);

    if minutes >= high_minutes || launches >= high_launches {
        "high".to_string()
    } else if minutes >= medium_minutes || launches >= medium_launches {
        "medium".to_string()
    } else {
        "low".to_string()
    }
}

fn setting_i64(settings: &HashMap<String, String>, key: &str, default: i64) -> i64 {
    settings
        .get(key)
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(default)
}

fn elapsed_minutes(started_at: &str) -> i64 {
    parse_datetime(started_at)
        .map(|started| {
            Utc::now()
                .signed_duration_since(started)
                .num_minutes()
                .max(0)
        })
        .unwrap_or(0)
}

fn parse_datetime(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|date| date.with_timezone(&Utc))
        .ok()
        .or_else(|| {
            NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M")
                .ok()
                .map(|date| DateTime::<Utc>::from_naive_utc_and_offset(date, Utc))
        })
}

fn validate_session_input(input: &UsageSessionInput) -> Result<(), String> {
    if input.started_at.trim().is_empty() {
        return Err("started_at is required".to_string());
    }
    if input.duration_minutes < 0 {
        return Err("duration_minutes must be positive".to_string());
    }
    if !(0.0..=1.0).contains(&input.confidence) {
        return Err("confidence must be between 0 and 1".to_string());
    }
    Ok(())
}

fn official_url(tool: &ToolKind) -> &'static str {
    match tool {
        ToolKind::Codex => OPENAI_USAGE_URL,
        ToolKind::ClaudeCode => CLAUDE_USAGE_URL,
    }
}

fn now_string() -> String {
    Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory database");
        migrate(&conn).expect("migrate database");
        conn
    }

    #[test]
    fn migration_creates_default_settings() {
        let conn = memory_conn();
        let settings = read_settings(&conn).expect("read settings");

        assert_eq!(settings.get("medium_minutes"), Some(&"120".to_string()));
        assert_eq!(settings.get("high_launches"), Some(&"10".to_string()));
        assert_eq!(settings.get("codex_high_minutes"), Some(&"240".to_string()));
        assert_eq!(
            settings.get("codex_hour_high_minutes"),
            Some(&"60".to_string())
        );
        assert_eq!(
            settings.get("claude_code_high_minutes"),
            Some(&"360".to_string())
        );
        assert_eq!(
            settings.get("claude_code_hour_window_minutes"),
            Some(&"10080".to_string())
        );
        assert_eq!(
            settings.get("claude_code_hour_high_minutes"),
            Some(&"360".to_string())
        );
        assert_eq!(
            settings.get("process_monitor_enabled"),
            Some(&"1".to_string())
        );
    }

    #[test]
    fn migration_updates_old_claude_code_defaults() {
        let conn = Connection::open_in_memory().expect("open in-memory database");
        conn.execute_batch(
            r#"
            CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            INSERT INTO settings (key, value, updated_at) VALUES
                ('claude_code_high_minutes', '240', 'old'),
                ('claude_code_hour_window_minutes', '300', 'old'),
                ('claude_code_hour_high_minutes', '60', 'old');
            "#,
        )
        .expect("seed old settings");

        migrate(&conn).expect("migrate database");
        let settings = read_settings(&conn).expect("read settings");

        assert_eq!(
            settings.get("claude_code_high_minutes"),
            Some(&"360".to_string())
        );
        assert_eq!(
            settings.get("claude_code_hour_window_minutes"),
            Some(&"10080".to_string())
        );
        assert_eq!(
            settings.get("claude_code_hour_high_minutes"),
            Some(&"360".to_string())
        );
    }

    #[test]
    fn dashboard_includes_scoped_manual_limits() {
        let conn = memory_conn();
        conn.execute(
            "INSERT INTO manual_limit_entries
             (tool, captured_at, scope, remaining_label, remaining_percent, reset_at, note, confidence, created_at)
             VALUES
             ('claude_code', '2026-05-19T09:00:00Z', 'session_5h', '50%', 50.0, '2026-05-19T14:00:00Z', NULL, 1.0, '2026-05-19T09:00:00Z'),
             ('claude_code', '2026-05-19T10:00:00Z', 'session_5h', '42%', 42.0, '2026-05-19T15:00:00Z', NULL, 1.0, '2026-05-19T10:00:00Z'),
             ('claude_code', '2026-05-19T10:05:00Z', 'weekly', '88%', 88.0, NULL, NULL, 1.0, '2026-05-19T10:05:00Z')",
            [],
        )
        .expect("insert manual limits");

        let dashboard = dashboard_for_date(&conn, "2026-05-19").expect("dashboard");
        let claude = dashboard
            .tools
            .iter()
            .find(|tool| tool.tool == "claude_code")
            .unwrap();
        let session = claude
            .manual_limits
            .iter()
            .find(|limit| limit.scope == "session_5h")
            .unwrap();
        let weekly = claude
            .manual_limits
            .iter()
            .find(|limit| limit.scope == "weekly")
            .unwrap();

        assert_eq!(session.remaining_label, "42%");
        assert_eq!(session.remaining_percent, Some(42.0));
        assert_eq!(session.reset_at.as_deref(), Some("2026-05-19T15:00:00Z"));
        assert_eq!(weekly.remaining_label, "88%");
    }

    #[test]
    fn dashboard_estimates_claude_session_reset_from_latest_session() {
        let conn = memory_conn();
        create_usage_session_impl(
            &conn,
            UsageSessionInput {
                tool: ToolKind::ClaudeCode,
                started_at: "2026-05-19T10:00:00Z".to_string(),
                ended_at: None,
                duration_minutes: 0,
                source: SourceKind::Estimated,
                confidence: 0.6,
                note: Some(AUTO_MONITOR_NOTE.to_string()),
            },
        )
        .expect("insert claude session");

        let dashboard = dashboard_for_date(&conn, "2026-05-19").expect("dashboard");
        let claude = dashboard
            .tools
            .iter()
            .find(|tool| tool.tool == "claude_code")
            .unwrap();

        assert_eq!(
            claude.estimated_session_reset_at.as_deref(),
            Some("2026-05-19T15:00:00+00:00")
        );
    }

    #[test]
    fn dashboard_aggregates_today_by_tool() {
        let conn = memory_conn();
        let now = Utc::now();
        create_usage_session_impl(
            &conn,
            UsageSessionInput {
                tool: ToolKind::Codex,
                started_at: (now - Duration::minutes(90)).to_rfc3339(),
                ended_at: Some(now.to_rfc3339()),
                duration_minutes: 90,
                source: SourceKind::Manual,
                confidence: 1.0,
                note: None,
            },
        )
        .expect("insert codex");
        create_usage_session_impl(
            &conn,
            UsageSessionInput {
                tool: ToolKind::ClaudeCode,
                started_at: (now - Duration::minutes(35)).to_rfc3339(),
                ended_at: None,
                duration_minutes: 35,
                source: SourceKind::Manual,
                confidence: 0.8,
                note: None,
            },
        )
        .expect("insert claude");

        let dashboard =
            dashboard_for_date(&conn, &now.format("%Y-%m-%d").to_string()).expect("dashboard");
        let codex = dashboard
            .tools
            .iter()
            .find(|tool| tool.tool == "codex")
            .unwrap();
        let claude = dashboard
            .tools
            .iter()
            .find(|tool| tool.tool == "claude_code")
            .unwrap();

        assert_eq!(codex.launch_count_today, 1);
        assert_eq!(codex.estimated_minutes_today, 90);
        assert_eq!(codex.attention_level, "low");
        assert_eq!(claude.launch_count_today, 1);
        assert_eq!(claude.estimated_minutes_today, 35);
    }

    #[test]
    fn attention_level_uses_default_thresholds() {
        let conn = memory_conn();
        for index in 0..5 {
            create_usage_session_impl(
                &conn,
                UsageSessionInput {
                    tool: ToolKind::Codex,
                    started_at: format!("2026-05-04T09:0{index}"),
                    ended_at: None,
                    duration_minutes: 10,
                    source: SourceKind::Manual,
                    confidence: 1.0,
                    note: None,
                },
            )
            .expect("insert session");
        }

        let dashboard = dashboard_for_date(&conn, "2026-05-04").expect("dashboard");
        let codex = dashboard
            .tools
            .iter()
            .find(|tool| tool.tool == "codex")
            .unwrap();

        assert_eq!(codex.launch_count_today, 5);
        assert_eq!(codex.attention_level, "medium");
    }

    #[test]
    fn attention_level_uses_tool_specific_thresholds() {
        let conn = memory_conn();
        let now = Utc::now();
        conn.execute(
            "UPDATE settings SET value = '60' WHERE key = 'claude_code_high_minutes'",
            [],
        )
        .expect("update setting");
        create_usage_session_impl(
            &conn,
            UsageSessionInput {
                tool: ToolKind::Codex,
                started_at: "2026-05-04T09:00".to_string(),
                ended_at: None,
                duration_minutes: 70,
                source: SourceKind::Manual,
                confidence: 1.0,
                note: None,
            },
        )
        .expect("insert codex");
        create_usage_session_impl(
            &conn,
            UsageSessionInput {
                tool: ToolKind::ClaudeCode,
                started_at: (now - Duration::minutes(70)).to_rfc3339(),
                ended_at: None,
                duration_minutes: 70,
                source: SourceKind::Manual,
                confidence: 1.0,
                note: None,
            },
        )
        .expect("insert claude");

        let dashboard =
            dashboard_for_date(&conn, &now.format("%Y-%m-%d").to_string()).expect("dashboard");
        let codex = dashboard
            .tools
            .iter()
            .find(|tool| tool.tool == "codex")
            .unwrap();
        let claude = dashboard
            .tools
            .iter()
            .find(|tool| tool.tool == "claude_code")
            .unwrap();

        assert_eq!(codex.attention_level, "low");
        assert_eq!(claude.attention_level, "high");
    }

    #[test]
    fn dashboard_aggregates_recent_window_by_tool() {
        let conn = memory_conn();
        let now = Utc::now();
        create_usage_session_impl(
            &conn,
            UsageSessionInput {
                tool: ToolKind::Codex,
                started_at: (now - Duration::minutes(30)).to_rfc3339(),
                ended_at: Some((now - Duration::minutes(10)).to_rfc3339()),
                duration_minutes: 20,
                source: SourceKind::Manual,
                confidence: 1.0,
                note: None,
            },
        )
        .expect("insert recent codex");
        create_usage_session_impl(
            &conn,
            UsageSessionInput {
                tool: ToolKind::ClaudeCode,
                started_at: (now - Duration::minutes(11000)).to_rfc3339(),
                ended_at: Some((now - Duration::minutes(10980)).to_rfc3339()),
                duration_minutes: 20,
                source: SourceKind::Manual,
                confidence: 1.0,
                note: None,
            },
        )
        .expect("insert old claude");

        let dashboard =
            dashboard_for_date(&conn, &now.format("%Y-%m-%d").to_string()).expect("dashboard");
        let codex = dashboard
            .tools
            .iter()
            .find(|tool| tool.tool == "codex")
            .unwrap();
        let claude = dashboard
            .tools
            .iter()
            .find(|tool| tool.tool == "claude_code")
            .unwrap();

        assert_eq!(codex.estimated_minutes_window, 20);
        assert_eq!(claude.estimated_minutes_window, 0);
    }

    #[test]
    fn process_scan_creates_updates_and_closes_auto_session() {
        let conn = memory_conn();

        scan_process_usage_impl(&conn, &["codex.exe".to_string()]).expect("scan running");
        let dashboard = dashboard_for_date(&conn, &Utc::now().format("%Y-%m-%d").to_string())
            .expect("dashboard");
        let codex = dashboard
            .tools
            .iter()
            .find(|tool| tool.tool == "codex")
            .unwrap();
        assert!(codex.is_running);
        assert_eq!(codex.launch_count_today, 1);

        scan_process_usage_impl(&conn, &Vec::<String>::new()).expect("scan stopped");
        let dashboard = dashboard_for_date(&conn, &Utc::now().format("%Y-%m-%d").to_string())
            .expect("dashboard");
        let codex = dashboard
            .tools
            .iter()
            .find(|tool| tool.tool == "codex")
            .unwrap();
        assert!(!codex.is_running);
    }

    fn ev(ts: &str, tokens: i64) -> TokenEvent {
        TokenEvent {
            timestamp: ts.parse().unwrap(),
            tokens,
        }
    }

    #[test]
    fn claude_code_quota_sums_session_tokens_and_burn_rate() {
        let now: DateTime<Utc> = "2026-05-19T00:00:00Z".parse().unwrap();
        let activity = ClaudeCodeActivity {
            prompts: vec![
                // Old session window (>5h before any active prompt)
                "2026-05-18T10:00:00Z".parse().unwrap(),
                // Current session starts here (gap > 5h)
                "2026-05-18T21:00:00Z".parse().unwrap(),
                "2026-05-18T22:00:00Z".parse().unwrap(),
                "2026-05-18T23:30:00Z".parse().unwrap(),
            ],
            token_events: vec![
                ev("2026-05-18T10:05:00Z", 1_000), // outside current session
                ev("2026-05-18T21:05:00Z", 7_000),
                ev("2026-05-18T22:05:00Z", 8_000),
                ev("2026-05-18T23:35:00Z", 9_000), // within last 30min of now (00:00)
            ],
        };

        // session_limit 100_000, burn_window 30min.
        let quota = compute_claude_code_quota(&activity, now, 300, 100_000, 30);
        assert_eq!(quota.session_used, 7_000 + 8_000 + 9_000);
        assert_eq!(
            quota.session_started_at.as_deref(),
            Some("2026-05-18T21:00:00+00:00")
        );
        assert_eq!(
            quota.session_reset_at.as_deref(),
            Some("2026-05-19T02:00:00+00:00")
        );
        // Burn rate: tokens in [23:30, 00:00] = 9_000 over 30 min → 300 tok/min
        assert!((quota.burn_rate_tokens_per_min - 300.0).abs() < 0.001);
        // Remaining = 100_000 - 24_000 = 76_000 → 76_000 / 300 ≈ 253 min → 00:00 + 253min ≈ 04:13.
        // But cap to session reset 02:00.
        assert_eq!(
            quota.projected_depletion_at.as_deref(),
            Some("2026-05-19T02:00:00+00:00")
        );
    }

    #[test]
    fn claude_code_quota_handles_expired_session() {
        let now: DateTime<Utc> = "2026-05-19T05:00:00Z".parse().unwrap();
        let activity = ClaudeCodeActivity {
            prompts: vec!["2026-05-18T10:00:00Z".parse().unwrap()],
            token_events: vec![ev("2026-05-18T10:05:00Z", 4_200)],
        };

        let quota = compute_claude_code_quota(&activity, now, 300, 100_000, 30);
        assert_eq!(quota.session_used, 0);
        assert!(quota.session_reset_at.is_none());
        assert!(quota.projected_depletion_at.is_none());
    }

    #[test]
    fn claude_code_quota_projects_depletion_within_session() {
        let now: DateTime<Utc> = "2026-05-19T00:00:00Z".parse().unwrap();
        let activity = ClaudeCodeActivity {
            prompts: vec!["2026-05-18T23:00:00Z".parse().unwrap()],
            token_events: vec![
                ev("2026-05-18T23:30:00Z", 10_000), // 10k tokens in last 30min
            ],
        };

        // limit 100k, used 10k, burn 10k / 30min ≈ 333 tok/min.
        // Remaining 90k / 333 ≈ 270 min → would deplete at 00:00 + 270 = 04:30,
        // capped to session reset 23:00 + 5h = 04:00.
        let quota = compute_claude_code_quota(&activity, now, 300, 100_000, 30);
        assert_eq!(quota.session_used, 10_000);
        assert_eq!(
            quota.projected_depletion_at.as_deref(),
            Some("2026-05-19T04:00:00+00:00")
        );
    }

    #[test]
    fn process_scan_respects_configured_process_names() {
        let conn = memory_conn();
        conn.execute(
            "UPDATE settings SET value = 'custom-claude.exe' WHERE key = 'claude_code_process_names'",
            [],
        )
        .expect("update setting");

        scan_process_usage_impl(&conn, &["custom-claude.exe".to_string()]).expect("scan running");
        let dashboard = dashboard_for_date(&conn, &Utc::now().format("%Y-%m-%d").to_string())
            .expect("dashboard");
        let claude = dashboard
            .tools
            .iter()
            .find(|tool| tool.tool == "claude_code")
            .unwrap();

        assert!(claude.is_running);
        assert_eq!(claude.launch_count_today, 1);
    }
}
