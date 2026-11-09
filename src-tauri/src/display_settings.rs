use serde_json::Value;
use tauri_plugin_store::StoreExt;

// The frontend can only read and write this one value in this one file. The
// generic Store IPC is not granted because it accepts arbitrary paths.
const FILE: &str = "display-settings.json";
const KEY: &str = "display";
const MAX_BYTES: usize = 16 * 1024;
const LOAD_FAILED: &str = "表示設定を読み込めませんでした。";
const SAVE_FAILED: &str = "表示設定を保存できませんでした。";

fn valid_settings(value: &Value) -> bool {
    value.is_object() && serde_json::to_vec(value).is_ok_and(|bytes| bytes.len() <= MAX_BYTES)
}

#[tauri::command]
pub fn load_display_settings(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    let store = app.store(FILE).map_err(|_| LOAD_FAILED)?;
    // The frontend normalizes the value; never hand back something oversized.
    Ok(store.get(KEY).filter(valid_settings))
}

#[tauri::command]
pub fn save_display_settings(app: tauri::AppHandle, settings: Value) -> Result<(), String> {
    if !valid_settings(&settings) {
        return Err(SAVE_FAILED.into());
    }
    let store = app.store(FILE).map_err(|_| SAVE_FAILED)?;
    store.set(KEY, settings);
    store.save().map_err(|_| SAVE_FAILED.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn accepts_only_bounded_objects() {
        assert!(valid_settings(
            &json!({"version": 1, "providers": ["codex"]})
        ));
        assert!(!valid_settings(&json!("display")));
        assert!(!valid_settings(&json!([1, 2, 3])));
        assert!(!valid_settings(&json!({"padding": "x".repeat(MAX_BYTES)})));
    }
}
