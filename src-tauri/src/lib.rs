use chrono::{
    DateTime, Datelike, Duration, FixedOffset, Local, NaiveDateTime, TimeZone, Utc, Weekday,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
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
    remaining_label: String,
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
    attention_level: String,
    official_usage_url: String,
    is_running: bool,
    active_session_started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quota_session_used: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quota_session_limit: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quota_session_reset_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quota_session_window_minutes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quota_weekly_used: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quota_weekly_limit: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    quota_weekly_window_minutes: Option<i64>,
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
            remaining_label TEXT NOT NULL,
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
        ("claude_code_process_names", "claude.exe,claude-code.exe,claude"),
        ("claude_code_session_window_minutes", "300"),
        ("claude_code_session_message_limit", "45"),
        ("claude_code_weekly_window_minutes", "10080"),
        ("claude_code_weekly_message_limit", "200"),
        ("claude_code_weekly_reset_weekday", "wednesday"),
        ("claude_code_weekly_reset_hour", "18"),
        ("claude_code_session_token_limit", "70000000"),
        ("claude_code_weekly_token_limit", "750000000"),
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
fn list_usage_logs(filter: Option<UsageLogFilter>, state: State<AppState>) -> Result<Vec<UsageSession>, String> {
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
fn update_usage_session(id: i64, input: UsageSessionInput, state: State<AppState>) -> Result<(), String> {
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
fn save_manual_limit_entry(input: ManualLimitEntryInput, state: State<AppState>) -> Result<i64, String> {
    if input.remaining_label.trim().is_empty() {
        return Err("remaining_label is required".to_string());
    }
    if !(0.0..=1.0).contains(&input.confidence) {
        return Err("confidence must be between 0 and 1".to_string());
    }
    let conn = state.conn.lock().map_err(|err| err.to_string())?;
    conn.execute(
        "INSERT INTO manual_limit_entries (tool, captured_at, remaining_label, reset_at, note, confidence, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            input.tool.as_str(),
            input.captured_at,
            input.remaining_label,
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
    let claude_code_activity = collect_claude_code_activity();
    let tools = vec![
        tool_dashboard(conn, ToolKind::Codex, "Codex", date, &settings, None)?,
        tool_dashboard(
            conn,
            ToolKind::ClaudeCode,
            "Claude Code",
            date,
            &settings,
            Some(&claude_code_activity),
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
    let active_session_started_at: Option<String> = conn
        .query_row(
            "SELECT started_at FROM usage_sessions
             WHERE tool = ?1 AND source = 'estimated' AND ended_at IS NULL AND note = ?2
             ORDER BY started_at DESC LIMIT 1",
            params![tool_key, AUTO_MONITOR_NOTE],
            |row| row.get(0),
        )
        .optional()?;

    let (
        quota_session_used,
        quota_session_limit,
        quota_session_reset_at,
        quota_session_window_minutes,
        quota_weekly_used,
        quota_weekly_limit,
        quota_weekly_window_minutes,
    ) = if matches!(tool, ToolKind::ClaudeCode) {
        let default_activity = ClaudeCodeActivity::default();
        let activity = claude_code_activity.unwrap_or(&default_activity);
        let session_window =
            setting_i64(settings, "claude_code_session_window_minutes", 300).max(1);
        let session_limit = setting_i64(settings, "claude_code_session_token_limit", 70_000_000);
        let weekly_limit = setting_i64(settings, "claude_code_weekly_token_limit", 750_000_000);
        let weekday = settings
            .get("claude_code_weekly_reset_weekday")
            .and_then(|v| parse_weekday(v))
            .unwrap_or(Weekday::Wed);
        let reset_hour = setting_i64(settings, "claude_code_weekly_reset_hour", 18)
            .clamp(0, 23) as u32;
        let local_offset = *Local::now().offset();
        let now = Utc::now();
        let quota = compute_claude_code_quota(
            activity,
            now,
            session_window,
            local_offset,
            weekday,
            reset_hour,
        );
        let weekly_window = quota.weekly_window_minutes;
        (
            Some(quota.session_used),
            Some(session_limit),
            quota.session_reset_at,
            Some(session_window),
            Some(quota.weekly_used),
            Some(weekly_limit),
            Some(weekly_window),
        )
    } else {
        (None, None, None, None, None, None, None)
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
        attention_level: attention_level(
            tool_key,
            estimated_minutes_today,
            launch_count_today,
            settings,
        ),
        official_usage_url: official_url(&tool).to_string(),
        is_running: active_session_started_at.is_some(),
        active_session_started_at,
        quota_session_used,
        quota_session_limit,
        quota_session_reset_at,
        quota_session_window_minutes,
        quota_weekly_used,
        quota_weekly_limit,
        quota_weekly_window_minutes,
    })
}

#[derive(Debug, Clone)]
struct ClaudeCodeQuota {
    session_used: i64,
    session_reset_at: Option<String>,
    weekly_used: i64,
    weekly_window_minutes: i64,
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
    local_offset: FixedOffset,
    weekly_reset_weekday: Weekday,
    weekly_reset_hour: u32,
) -> ClaudeCodeQuota {
    let session_window = Duration::minutes(session_window_minutes.max(1));

    let mut sorted_prompts = activity.prompts.clone();
    sorted_prompts.sort();

    // Walk forward, opening a new session window when the next prompt falls outside the active one.
    let mut current_window_start: Option<DateTime<Utc>> = None;
    for ts in &sorted_prompts {
        match current_window_start {
            Some(start) if *ts < start + session_window => {}
            _ => current_window_start = Some(*ts),
        }
    }

    let (session_used, session_reset_at) = match current_window_start {
        Some(start) => {
            let end = start + session_window;
            if now < end {
                let used: i64 = activity
                    .token_events
                    .iter()
                    .filter(|ev| ev.timestamp >= start && ev.timestamp < end)
                    .map(|ev| ev.tokens)
                    .sum();
                (used, Some(end.to_rfc3339()))
            } else {
                (0, None)
            }
        }
        None => (0, None),
    };

    let weekly_start = most_recent_weekly_reset(
        now,
        local_offset,
        weekly_reset_weekday,
        weekly_reset_hour,
    );
    let weekly_used: i64 = activity
        .token_events
        .iter()
        .filter(|ev| ev.timestamp >= weekly_start)
        .map(|ev| ev.tokens)
        .sum();
    let weekly_window_minutes = now
        .signed_duration_since(weekly_start)
        .num_minutes()
        .max(0);

    ClaudeCodeQuota {
        session_used,
        session_reset_at,
        weekly_used,
        weekly_window_minutes,
    }
}

fn most_recent_weekly_reset(
    now: DateTime<Utc>,
    local_offset: FixedOffset,
    weekday: Weekday,
    hour: u32,
) -> DateTime<Utc> {
    let now_local = now.with_timezone(&local_offset);
    let today_diff = (now_local.weekday().num_days_from_monday() as i64
        - weekday.num_days_from_monday() as i64
        + 7)
        % 7;
    let candidate_date = (now_local - Duration::days(today_diff)).date_naive();
    let candidate_naive = candidate_date
        .and_hms_opt(hour, 0, 0)
        .unwrap_or_else(|| candidate_date.and_hms_opt(0, 0, 0).expect("midnight valid"));
    let candidate = local_offset
        .from_local_datetime(&candidate_naive)
        .single()
        .unwrap_or_else(|| local_offset.from_utc_datetime(&candidate_naive));
    let candidate = if candidate > now_local {
        candidate - Duration::days(7)
    } else {
        candidate
    };
    candidate.with_timezone(&Utc)
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

fn claude_code_projects_dir() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    Some(PathBuf::from(home).join(".claude").join("projects"))
}

fn collect_claude_code_activity() -> ClaudeCodeActivity {
    let Some(root) = claude_code_projects_dir() else {
        return ClaudeCodeActivity::default();
    };
    let mut activity = ClaudeCodeActivity::default();
    collect_activity_from_dir(&root, &mut activity);
    activity
}

fn collect_activity_from_dir(dir: &Path, out: &mut ClaudeCodeActivity) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.eq_ignore_ascii_case("subagents"))
            .unwrap_or(false)
        {
            continue;
        }
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if file_type.is_dir() {
            collect_activity_from_dir(&path, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            extract_activity_from_jsonl(&path, out);
        }
    }
}

fn extract_activity_from_jsonl(path: &Path, out: &mut ClaudeCodeActivity) {
    let Ok(file) = fs::File::open(path) else {
        return;
    };
    let reader = BufReader::new(file);
    // promptId -> earliest timestamp for that prompt turn (used for session boundary).
    let mut by_prompt: HashMap<String, DateTime<Utc>> = HashMap::new();
    let mut anonymous_prompts: Vec<DateTime<Utc>> = Vec::new();
    for line in reader.lines().map_while(Result::ok) {
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        if value.get("isSidechain").and_then(|v| v.as_bool()) == Some(true) {
            continue;
        }
        match value.get("type").and_then(|v| v.as_str()) {
            Some("user") => {
                if value.get("userType").and_then(|v| v.as_str()) != Some("external") {
                    continue;
                }
                if is_tool_result_message(&value) {
                    continue;
                }
                let Some(timestamp) = value.get("timestamp").and_then(|v| v.as_str()) else {
                    continue;
                };
                let Some(ts) = parse_datetime(timestamp) else {
                    continue;
                };
                match value.get("promptId").and_then(|v| v.as_str()) {
                    Some(prompt_id) => {
                        by_prompt
                            .entry(prompt_id.to_string())
                            .and_modify(|existing| {
                                if ts < *existing {
                                    *existing = ts;
                                }
                            })
                            .or_insert(ts);
                    }
                    None => anonymous_prompts.push(ts),
                }
            }
            Some("assistant") => {
                let Some(timestamp) = value.get("timestamp").and_then(|v| v.as_str()) else {
                    continue;
                };
                let Some(ts) = parse_datetime(timestamp) else {
                    continue;
                };
                let Some(usage) = value.pointer("/message/usage") else {
                    continue;
                };
                let tokens = sum_assistant_tokens(usage);
                if tokens > 0 {
                    out.token_events.push(TokenEvent { timestamp: ts, tokens });
                }
            }
            _ => {}
        }
    }
    out.prompts.extend(by_prompt.into_values());
    out.prompts.extend(anonymous_prompts);
}

fn sum_assistant_tokens(usage: &serde_json::Value) -> i64 {
    fn field(usage: &serde_json::Value, key: &str) -> i64 {
        usage
            .get(key)
            .and_then(|v| v.as_i64())
            .unwrap_or(0)
            .max(0)
    }
    field(usage, "input_tokens")
        + field(usage, "cache_creation_input_tokens")
        + field(usage, "cache_read_input_tokens")
        + field(usage, "output_tokens")
}

fn is_tool_result_message(value: &serde_json::Value) -> bool {
    let Some(content) = value.pointer("/message/content") else {
        return false;
    };
    let Some(array) = content.as_array() else {
        return false;
    };
    if array.is_empty() {
        return false;
    }
    array
        .iter()
        .all(|item| item.get("type").and_then(|t| t.as_str()) == Some("tool_result"))
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

fn list_usage_logs_impl(conn: &Connection, filter: Option<UsageLogFilter>) -> rusqlite::Result<Vec<UsageSession>> {
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

fn rolling_window_minutes(conn: &Connection, tool: &str, window_minutes: i64) -> rusqlite::Result<i64> {
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
            total += overlap_end.signed_duration_since(overlap_start).num_minutes().max(0);
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

fn update_tool_process_state(conn: &Connection, tool: ToolKind, is_running: bool) -> rusqlite::Result<()> {
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

fn attention_level(tool: &str, minutes: i64, launches: i64, settings: &HashMap<String, String>) -> String {
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
        .map(|started| Utc::now().signed_duration_since(started).num_minutes().max(0))
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
        assert_eq!(settings.get("codex_hour_high_minutes"), Some(&"60".to_string()));
        assert_eq!(settings.get("claude_code_high_minutes"), Some(&"360".to_string()));
        assert_eq!(settings.get("claude_code_hour_window_minutes"), Some(&"10080".to_string()));
        assert_eq!(settings.get("claude_code_hour_high_minutes"), Some(&"360".to_string()));
        assert_eq!(settings.get("process_monitor_enabled"), Some(&"1".to_string()));
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

        assert_eq!(settings.get("claude_code_high_minutes"), Some(&"360".to_string()));
        assert_eq!(settings.get("claude_code_hour_window_minutes"), Some(&"10080".to_string()));
        assert_eq!(settings.get("claude_code_hour_high_minutes"), Some(&"360".to_string()));
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

        let dashboard = dashboard_for_date(&conn, &now.format("%Y-%m-%d").to_string()).expect("dashboard");
        let codex = dashboard.tools.iter().find(|tool| tool.tool == "codex").unwrap();
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
        let codex = dashboard.tools.iter().find(|tool| tool.tool == "codex").unwrap();

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

        let dashboard = dashboard_for_date(&conn, &now.format("%Y-%m-%d").to_string()).expect("dashboard");
        let codex = dashboard.tools.iter().find(|tool| tool.tool == "codex").unwrap();
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

        let dashboard = dashboard_for_date(&conn, &now.format("%Y-%m-%d").to_string()).expect("dashboard");
        let codex = dashboard.tools.iter().find(|tool| tool.tool == "codex").unwrap();
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
        let codex = dashboard.tools.iter().find(|tool| tool.tool == "codex").unwrap();
        assert!(codex.is_running);
        assert_eq!(codex.launch_count_today, 1);

        scan_process_usage_impl(&conn, &Vec::<String>::new()).expect("scan stopped");
        let dashboard = dashboard_for_date(&conn, &Utc::now().format("%Y-%m-%d").to_string())
            .expect("dashboard");
        let codex = dashboard.tools.iter().find(|tool| tool.tool == "codex").unwrap();
        assert!(!codex.is_running);
    }

    fn jst() -> FixedOffset {
        FixedOffset::east_opt(9 * 3600).unwrap()
    }

    fn ev(ts: &str, tokens: i64) -> TokenEvent {
        TokenEvent {
            timestamp: ts.parse().unwrap(),
            tokens,
        }
    }

    #[test]
    fn claude_code_quota_sums_session_and_weekly_tokens() {
        let now: DateTime<Utc> = "2026-05-19T00:00:00Z".parse().unwrap();
        let activity = ClaudeCodeActivity {
            prompts: vec![
                // Before weekly reset (2026-05-13 09:00 UTC)
                "2026-05-13T08:30:00Z".parse().unwrap(),
                // After reset, but old session window
                "2026-05-13T10:00:00Z".parse().unwrap(),
                // Current session starts here (gap > 5h)
                "2026-05-18T21:00:00Z".parse().unwrap(),
                "2026-05-18T22:00:00Z".parse().unwrap(),
                "2026-05-18T23:30:00Z".parse().unwrap(),
            ],
            token_events: vec![
                ev("2026-05-13T08:30:00Z", 1_000),  // before weekly reset → excluded
                ev("2026-05-13T10:05:00Z", 5_000),  // weekly only
                ev("2026-05-18T21:05:00Z", 7_000),  // session + weekly
                ev("2026-05-18T22:05:00Z", 8_000),  // session + weekly
                ev("2026-05-18T23:35:00Z", 9_000),  // session + weekly
            ],
        };

        let quota = compute_claude_code_quota(&activity, now, 300, jst(), Weekday::Wed, 18);
        assert_eq!(quota.session_used, 7_000 + 8_000 + 9_000);
        assert_eq!(quota.session_reset_at.as_deref(), Some("2026-05-19T02:00:00+00:00"));
        assert_eq!(quota.weekly_used, 5_000 + 7_000 + 8_000 + 9_000);
    }

    #[test]
    fn claude_code_quota_handles_expired_session() {
        let now: DateTime<Utc> = "2026-05-19T05:00:00Z".parse().unwrap();
        let activity = ClaudeCodeActivity {
            prompts: vec!["2026-05-18T10:00:00Z".parse().unwrap()],
            token_events: vec![ev("2026-05-18T10:05:00Z", 4_200)],
        };

        let quota = compute_claude_code_quota(&activity, now, 300, jst(), Weekday::Wed, 18);
        assert_eq!(quota.session_used, 0);
        assert!(quota.session_reset_at.is_none());
        assert_eq!(quota.weekly_used, 4_200);
    }

    #[test]
    fn weekly_reset_rewinds_when_today_is_reset_day_before_hour() {
        // 2026-05-20 (Wed) 14:00 JST = 2026-05-20 05:00 UTC, before the 18:00 cut-off.
        // The most recent reset should be the previous Wednesday 18:00 JST.
        let now: DateTime<Utc> = "2026-05-20T05:00:00Z".parse().unwrap();
        let start = most_recent_weekly_reset(now, jst(), Weekday::Wed, 18);
        // 2026-05-13 18:00 JST = 2026-05-13 09:00 UTC
        assert_eq!(start.to_rfc3339(), "2026-05-13T09:00:00+00:00");
    }

    #[test]
    fn weekly_reset_picks_today_when_past_reset_hour() {
        // 2026-05-20 (Wed) 20:00 JST = 2026-05-20 11:00 UTC, after the 18:00 cut-off.
        let now: DateTime<Utc> = "2026-05-20T11:00:00Z".parse().unwrap();
        let start = most_recent_weekly_reset(now, jst(), Weekday::Wed, 18);
        assert_eq!(start.to_rfc3339(), "2026-05-20T09:00:00+00:00");
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
