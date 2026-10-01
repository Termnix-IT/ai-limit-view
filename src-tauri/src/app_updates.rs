use reqwest::{Client, StatusCode};
use semver::Version;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri_plugin_opener::OpenerExt;

const LATEST_RELEASE_API: &str =
    "https://api.github.com/repos/Termnix-IT/ai-limit-view/releases/latest";
const RELEASE_PAGE: &str = "https://github.com/Termnix-IT/ai-limit-view/releases/latest";
const CHECK_TIMEOUT: Duration = Duration::from_secs(15);
const INVALID_RELEASE: &str =
    "更新情報を確認できませんでした。配布ページを確認するか、時間をおいて再試行してください。";

#[derive(Debug, Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct ReleaseAsset {
    name: String,
    state: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdate {
    current_version: String,
    latest_version: String,
    available: bool,
    checked_at: String,
}

fn compare_release(release: Release, current: &str) -> Result<AppUpdate, String> {
    let current_version = Version::parse(current).map_err(|_| INVALID_RELEASE)?;
    let latest = release
        .tag_name
        .strip_prefix('v')
        .unwrap_or(&release.tag_name);
    let latest_version = Version::parse(latest).map_err(|_| INVALID_RELEASE)?;
    let installer = format!("LimitView_{latest_version}_x64-setup.exe");
    if release.draft
        || release.prerelease
        || !latest_version.pre.is_empty()
        || !release
            .assets
            .iter()
            .any(|asset| asset.name == installer && asset.state == "uploaded")
    {
        return Err(INVALID_RELEASE.into());
    }
    Ok(AppUpdate {
        current_version: current.into(),
        latest_version: latest_version.to_string(),
        available: latest_version.cmp_precedence(&current_version).is_gt(),
        checked_at: chrono::Utc::now().to_rfc3339(),
    })
}

fn status_error(status: StatusCode) -> &'static str {
    match status {
        StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS => {
            "GitHub が更新確認を制限または拒否しています。時間をおいて再試行してください。"
        }
        StatusCode::NOT_FOUND => {
            "公開されている更新情報が見つかりません。配布ページを確認してください。"
        }
        _ => "更新情報の配信元でエラーが発生しました。時間をおいて再試行してください。",
    }
}

#[tauri::command]
pub async fn check_app_update(app: tauri::AppHandle) -> Result<AppUpdate, String> {
    // Bound both the request and response decoding. Never return response bodies or diagnostics.
    tokio::time::timeout(CHECK_TIMEOUT, async {
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(CHECK_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(format!("LimitView/{}", app.package_info().version))
            .build()
            .map_err(|_| "更新確認を開始できませんでした。再試行してください。")?;
        let response = client
            .get(LATEST_RELEASE_API)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
            .map_err(|error| {
                if error.is_timeout() {
                    "更新確認がタイムアウトしました。時間をおいて再試行してください。"
                } else {
                    "更新情報に接続できません。通信環境を確認して再試行してください。"
                }
            })?;
        if !response.status().is_success() {
            return Err(status_error(response.status()).into());
        }
        let release = response
            .json::<Release>()
            .await
            .map_err(|_| INVALID_RELEASE)?;
        compare_release(release, &app.package_info().version.to_string())
    })
    .await
    .map_err(|_| "更新確認がタイムアウトしました。時間をおいて再試行してください。".to_string())?
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

    fn release(version: &str) -> Release {
        Release {
            tag_name: format!("v{version}"),
            draft: false,
            prerelease: false,
            assets: vec![ReleaseAsset {
                name: format!("LimitView_{version}_x64-setup.exe"),
                state: "uploaded".into(),
            }],
        }
    }

    #[test]
    fn compares_versions_numerically_and_does_not_offer_downgrades() {
        for (current, latest, available) in [
            ("0.1.9", "0.1.10", true),
            ("0.1.12", "0.1.12", false),
            ("0.1.12", "0.1.11", false),
            ("0.1.12", "0.2.0", true),
            ("0.1.12+local", "0.1.12+public", false),
        ] {
            let result = compare_release(release(latest), current).unwrap();
            assert_eq!(result.available, available);
            assert_eq!(result.current_version, current);
            assert_eq!(result.latest_version, latest);
        }
    }

    #[test]
    fn rejects_drafts_prereleases_and_unavailable_installers() {
        let mut draft = release("0.1.13");
        draft.draft = true;
        let mut prerelease = release("0.1.13");
        prerelease.prerelease = true;
        let mut missing = release("0.1.13");
        missing.assets.clear();
        let mut uploading = release("0.1.13");
        uploading.assets[0].state = "new".into();
        let mut wrong_platform = release("0.1.13");
        wrong_platform.assets[0].name = "LimitView_aarch64.dmg".into();
        let mut invalid_tag = release("0.1.13");
        invalid_tag.tag_name = "private-diagnostic".into();
        for release in [
            draft,
            prerelease,
            release("0.1.13-beta.1"),
            missing,
            uploading,
            wrong_platform,
            invalid_tag,
        ] {
            assert_eq!(
                compare_release(release, "0.1.12").unwrap_err(),
                INVALID_RELEASE
            );
        }
    }

    #[test]
    fn parses_release_payload_and_serializes_camel_case() {
        let payload = serde_json::json!({"tag_name":"v0.1.13", "draft":false, "prerelease":false,
            "assets":[{"name":"LimitView_0.1.13_x64-setup.exe", "state":"uploaded"}], "body":"private-diagnostic"});
        let release: Release = serde_json::from_value(payload).unwrap();
        let value = serde_json::to_value(compare_release(release, "0.1.12").unwrap()).unwrap();
        assert_eq!(value["available"], true);
        assert_eq!(value["currentVersion"], "0.1.12");
        assert_eq!(value["latestVersion"], "0.1.13");
        assert!(value["checkedAt"].is_string());
        assert!(!value.to_string().contains("private-diagnostic"));
    }

    #[test]
    fn classifies_http_errors_without_response_bodies() {
        assert!(status_error(StatusCode::TOO_MANY_REQUESTS).contains("制限"));
        assert!(status_error(StatusCode::NOT_FOUND).contains("見つかりません"));
        assert!(status_error(StatusCode::INTERNAL_SERVER_ERROR).contains("配信元"));
    }
}
