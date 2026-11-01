use serde::Serialize;
use std::time::Duration;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

const RELEASE_PAGE: &str = "https://github.com/Termnix-IT/ai-limit-view/releases/latest";
const CHECK_TIMEOUT: Duration = Duration::from_secs(15);
const INSTALL_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const CHECK_FAILED: &str =
    "更新情報を確認できませんでした。通信環境を確認するか、配布ページを確認してください。";
const INSTALL_FAILED: &str =
    "更新をインストールできませんでした。再試行するか、配布ページからインストーラーを取得してください。";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdate {
    current_version: String,
    latest_version: Option<String>,
    available: bool,
    checked_at: String,
}

fn app_update(current: String, newer: Option<String>) -> AppUpdate {
    AppUpdate {
        current_version: current,
        available: newer.is_some(),
        latest_version: newer,
        checked_at: chrono::Utc::now().to_rfc3339(),
    }
}

// Never return plugin errors; they can contain URLs and response details.
#[tauri::command]
pub async fn check_app_update(app: tauri::AppHandle) -> Result<AppUpdate, String> {
    let update = app
        .updater_builder()
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|_| CHECK_FAILED)?
        .check()
        .await
        .map_err(|_| CHECK_FAILED)?;
    Ok(app_update(
        app.package_info().version.to_string(),
        update.map(|update| update.version),
    ))
}

#[tauri::command]
pub async fn install_app_update(app: tauri::AppHandle) -> Result<(), String> {
    // The plugin verifies the signature before running the installer. On Windows the
    // installer exits this app and restarts it, so success does not return to the UI.
    let update = app
        .updater_builder()
        .timeout(INSTALL_TIMEOUT)
        .build()
        .map_err(|_| INSTALL_FAILED)?
        .check()
        .await
        .map_err(|_| INSTALL_FAILED)?
        .ok_or(INSTALL_FAILED)?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|_| INSTALL_FAILED)?;
    app.restart()
}

#[tauri::command]
pub fn open_release_page(app: tauri::AppHandle) -> Result<(), String> {
    // The frontend cannot supply arbitrary URLs, paths, or programs to the opener.
    app.opener()
        .open_url(RELEASE_PAGE, None::<&str>)
        .map_err(|_| "配布ページを開けませんでした。既定のブラウザーを確認してください。".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_available_update_in_camel_case() {
        let value =
            serde_json::to_value(app_update("0.1.12".into(), Some("0.1.13".into()))).unwrap();
        assert_eq!(value["available"], true);
        assert_eq!(value["currentVersion"], "0.1.12");
        assert_eq!(value["latestVersion"], "0.1.13");
        assert!(value["checkedAt"].is_string());
    }

    #[test]
    fn reports_no_update_without_inventing_a_latest_version() {
        let value = serde_json::to_value(app_update("0.1.12".into(), None)).unwrap();
        assert_eq!(value["available"], false);
        assert!(value["latestVersion"].is_null());
    }
}
