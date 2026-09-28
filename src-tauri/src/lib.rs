use tauri::Manager;

mod live_limits;
mod process;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_background_color(Some(tauri::webview::Color(0, 0, 0, 0)));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![live_limits::get_provider_limits])
        .run(tauri::generate_context!())
        .expect("failed to run LimitView");
}
