//! Dupo — design studio for documents, videos, and presentations.

mod commands;
mod export;
mod mcp;
mod settings;
mod store;

use commands::SharedApp;
use tauri::Manager;

pub fn run() {
    let settings = settings::Settings::load();
    let shared = SharedApp::new(settings);

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(shared.clone())
        .setup(move |app| {
            commands::set_app_handle(app.handle().clone());
            // Auto-start the MCP server when the setting asks for it.
            if shared.settings().mcp_enabled {
                let state = app.state::<SharedApp>().inner().clone();
                std::thread::spawn(move || {
                    if let Err(error) = mcp::start(state) {
                        eprintln!("dupo: MCP autostart failed: {error}");
                    }
                });
            }
            Ok(())
        })
        .register_uri_scheme_protocol("media", move |context, request| {
            serve_media(context.app_handle(), request)
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::reload_projects,
            commands::save_settings,
            commands::read_project,
            commands::write_project,
            commands::create_project,
            commands::delete_project,
            commands::save_media,
            commands::import_media,
            commands::log_message,
            commands::mcp_status,
            commands::mcp_start,
            commands::mcp_stop,
            commands::pick_folder,
            commands::pick_file,
            commands::export_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running dupo");
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&input[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn guess_mime(name: &str) -> &'static str {
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(".img") || lower.ends_with(".png") {
        return "image/png";
    }
    if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        return "image/jpeg";
    }
    if lower.ends_with(".gif") {
        return "image/gif";
    }
    if lower.ends_with(".webp") {
        return "image/webp";
    }
    if lower.ends_with(".svg") {
        return "image/svg+xml";
    }
    if lower.ends_with(".mp4") {
        return "video/mp4";
    }
    if lower.ends_with(".webm") {
        return "video/webm";
    }
    if lower.ends_with(".mov") {
        return "video/quicktime";
    }
    "application/octet-stream"
}

fn media_root<R: tauri::Runtime>(app_handle: &tauri::AppHandle<R>) -> Option<std::path::PathBuf> {
    let shared = app_handle.state::<SharedApp>();
    let folder = std::path::PathBuf::from(shared.settings().projects_folder);
    Some(folder)
}

fn serve_media<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    // media://localhost/<name> (or media://<name>) serves files from <projects folder>/media.
    let path = request.uri().path().trim_start_matches('/');
    let path = path.strip_prefix("localhost/").unwrap_or(path);
    let name = percent_decode(path);
    let builder = tauri::http::Response::builder().header("Access-Control-Allow-Origin", "*");
    let root = match media_root(app_handle) {
        Some(root) => root,
        None => return builder.status(404).body(b"media folder unavailable".to_vec()).unwrap(),
    };
    let file = root.join("media").join(&name);
    if !file.exists() {
        return builder.status(404).body(b"not found".to_vec()).unwrap();
    }
    match std::fs::read(&file) {
        Ok(bytes) => builder
            .header("Content-Type", guess_mime(&name))
            .body(bytes)
            .unwrap(),
        Err(error) => builder.status(500).body(error.to_string().into_bytes()).unwrap(),
    }
}
