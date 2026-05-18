use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Manager, State};

const OPENAI_USAGE_URL: &str = "https://platform.openai.com/usage";
const CLAUDE_USAGE_URL: &str =
    "https://support.anthropic.com/en/articles/12157520-claude-code-usage-analytics";

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
    last_used_at: Option<String>,
    latest_status_summary: Option<String>,
    status_saved: bool,
    latest_manual_remaining: Option<String>,
    attention_level: String,
    official_usage_url: String,
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
        ("medium_launches", "5"),
        ("high_launches", "10"),
    ] {
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
            params![key, value, now],
        )?;
    }

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
            "medium_minutes" | "high_minutes" | "medium_launches" | "high_launches"
        ) {
            return Err(format!("unsupported setting key: {}", entry.key));
        }
        let value = entry
            .value
            .parse::<i64>()
            .map_err(|_| format!("setting must be an integer: {}", entry.key))?;
        if value < 0 {
            return Err(format!("setting must be positive: {}", entry.key));
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
fn open_official_usage_url(tool: ToolKind) -> Result<(), String> {
    open::that(official_url(&tool)).map_err(|err| err.to_string())
}

fn dashboard_for_date(conn: &Connection, date: &str) -> rusqlite::Result<Dashboard> {
    let settings = read_settings(conn)?;
    let tools = vec![
        tool_dashboard(conn, ToolKind::Codex, "Codex", date, &settings)?,
        tool_dashboard(conn, ToolKind::ClaudeCode, "Claude Code", date, &settings)?,
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
) -> rusqlite::Result<ToolDashboard> {
    let tool_key = tool.as_str();
    let (launch_count_today, estimated_minutes_today): (i64, i64) = conn.query_row(
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

    Ok(ToolDashboard {
        tool: tool_key.to_string(),
        label: label.to_string(),
        launch_count_today,
        estimated_minutes_today,
        last_used_at,
        latest_status_summary: latest_status_summary.clone(),
        status_saved: latest_status_summary.is_some(),
        latest_manual_remaining,
        attention_level: attention_level(estimated_minutes_today, launch_count_today, settings),
        official_usage_url: official_url(&tool).to_string(),
    })
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

fn read_settings(conn: &Connection) -> rusqlite::Result<HashMap<String, String>> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let mut rows = stmt.query([])?;
    let mut settings = HashMap::new();
    while let Some(row) = rows.next()? {
        settings.insert(row.get(0)?, row.get(1)?);
    }
    Ok(settings)
}

fn attention_level(minutes: i64, launches: i64, settings: &HashMap<String, String>) -> String {
    let medium_minutes = setting_i64(settings, "medium_minutes", 120);
    let high_minutes = setting_i64(settings, "high_minutes", 240);
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
    }

    #[test]
    fn dashboard_aggregates_today_by_tool() {
        let conn = memory_conn();
        create_usage_session_impl(
            &conn,
            UsageSessionInput {
                tool: ToolKind::Codex,
                started_at: "2026-05-04T09:00".to_string(),
                ended_at: Some("2026-05-04T10:30".to_string()),
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
                started_at: "2026-05-04T11:00".to_string(),
                ended_at: None,
                duration_minutes: 35,
                source: SourceKind::Manual,
                confidence: 0.8,
                note: None,
            },
        )
        .expect("insert claude");

        let dashboard = dashboard_for_date(&conn, "2026-05-04").expect("dashboard");
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
}
