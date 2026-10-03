use tauri::Manager;

mod app_updates;
mod claude_auth;
mod live_limits;
mod process;

pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_background_color(Some(tauri::webview::Color(0, 0, 0, 0)));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            live_limits::get_provider_limits,
            app_updates::check_app_update,
            app_updates::open_release_page
        ])
        .run(tauri::generate_context!())
        .expect("failed to run LimitView");
}
