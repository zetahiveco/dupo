//! Tauri command handlers — the bridge between the webview and the store.

use crate::mcp::{self, Running, Status};
use crate::settings::Settings;
use crate::store::{self, ProjectMeta};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Shared app state: an Arc'd cloneable view used by both Tauri commands and
/// the MCP server threads.
#[derive(Clone)]
pub struct SharedApp {
    inner: std::sync::Arc<AppStatePtr>,
}

struct AppStatePtr {
    settings: Mutex<Settings>,
    mcp: Mutex<Option<Running>>,
}

impl SharedApp {
    pub fn new(settings: Settings) -> SharedApp {
        SharedApp {
            inner: std::sync::Arc::new(AppStatePtr {
                settings: Mutex::new(settings),
                mcp: Mutex::new(None),
            }),
        }
    }

    pub fn settings(&self) -> Settings {
        self.inner.settings.lock().map(|s| s.clone()).unwrap_or_default()
    }

    pub fn save_settings(&self, settings: Settings) -> Result<(), String> {
        settings.save()?;
        if let Ok(mut guard) = self.inner.settings.lock() {
            *guard = settings;
        }
        Ok(())
    }

    pub fn mcp_running(&self) -> bool {
        self.inner.mcp.lock().map(|m| m.is_some()).unwrap_or(false)
    }

    pub fn set_mcp(&self, running: Running) {
        if let Ok(mut guard) = self.inner.mcp.lock() {
            *guard = Some(running);
        }
    }

    pub fn clear_mcp(&self) {
        if let Ok(mut guard) = self.inner.mcp.lock() {
            *guard = None;
        }
    }

}

static APP_HANDLE: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

/// Called once from setup so commands can reach the dialog plugin.
pub fn set_app_handle(app: tauri::AppHandle) {
    let _ = APP_HANDLE.set(app);
}

pub fn app_handle() -> Option<tauri::AppHandle> {
    APP_HANDLE.get().cloned()
}

fn folder_of(shared: &SharedApp) -> Result<PathBuf, String> {
    let folder = PathBuf::from(shared.settings().projects_folder);
    store::ensure_folder(&folder)?;
    Ok(folder)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub settings: Settings,
    pub projects: Vec<ProjectMeta>,
    pub mcp: Status,
}

#[tauri::command]
pub fn get_snapshot(shared: tauri::State<'_, SharedApp>) -> Result<Snapshot, String> {
    let settings = shared.settings();
    let folder = PathBuf::from(settings.projects_folder.clone());
    let _ = store::ensure_folder(&folder);
    let projects = store::scan(&folder);
    let mcp = mcp::status(&shared);
    Ok(Snapshot { settings, projects, mcp })
}

#[tauri::command]
pub fn reload_projects(shared: tauri::State<'_, SharedApp>, path: String) -> Result<Vec<ProjectMeta>, String> {
    let root = PathBuf::from(path);
    store::ensure_folder(&root)?;
    let mut settings = shared.settings();
    settings.projects_folder = root.to_string_lossy().into_owned();
    shared.save_settings(settings)?;
    Ok(store::scan(&root))
}

#[tauri::command]
pub fn save_settings(shared: tauri::State<'_, SharedApp>, settings: Settings) -> Result<Snapshot, String> {
    if settings.projects_folder.trim().is_empty() {
        return Err("The projects folder cannot be empty".into());
    }
    shared.save_settings(settings.clone())?;
    let folder = PathBuf::from(settings.projects_folder.clone());
    let _ = store::ensure_folder(&folder);
    let projects = store::scan(&folder);
    let mcp = mcp::status(&shared);
    Ok(Snapshot { settings, projects, mcp })
}

#[tauri::command]
pub fn read_project(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err("Project file not found".into());
    }
    std::fs::read_to_string(path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn write_project(path: String, content: String) -> Result<(), String> {
    std::fs::write(PathBuf::from(path), content).map_err(|error| error.to_string())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProject {
    pub kind: String,
    pub name: String,
    pub preset: String,
    pub width: f64,
    pub height: f64,
}

#[tauri::command]
pub fn create_project(shared: tauri::State<'_, SharedApp>, new_project: NewProject) -> Result<ProjectMeta, String> {
    let kind = new_project.kind.as_str();
    if !matches!(kind, "documents" | "presentations" | "videos") {
        return Err("Unknown project kind".into());
    }
    let name = new_project.name.trim();
    if name.is_empty() {
        return Err("Give the project a name".into());
    }
    let folder = folder_of(&shared)?;
    let payload = serde_json::json!({
        "version": 1,
        "kind": kind,
        "name": name,
        "preset": new_project.preset,
        "width": new_project.width.round() as u32,
        "height": new_project.height.round() as u32,
        "pages": [{ "id": store::now_id("p"), "background": "#ffffff", "shapes": [] }],
        "clips": [],
        "texts": []
    });
    let path = store::unique_path(&folder, name, "dupo");
    std::fs::write(&path, serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?)
        .map_err(|error| format!("Could not create the project: {error}"))?;
    Ok(ProjectMeta {
        id: path.to_string_lossy().into_owned(),
        kind: kind.to_string(),
        name: name.to_string(),
        path: path.to_string_lossy().into_owned(),
        width: new_project.width.round(),
        height: new_project.height.round(),
        updated_at: stamp(&path),
    })
}

fn stamp(path: &Path) -> u64 {
    std::fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn delete_project(path: String) -> Result<(), String> {
    let path = PathBuf::from(&path);
    if path.extension().and_then(|e| e.to_str()) == Some("dupo") {
        std::fs::remove_file(path).map_err(|error| error.to_string())
    } else {
        Err("Refusing to delete a non-project file".into())
    }
}

#[tauri::command]
pub fn save_media(shared: tauri::State<'_, SharedApp>, name: String, base64_data: String) -> Result<String, String> {
    use base64::Engine;
    let folder = folder_of(&shared)?;
    let media = store::media_folder(&folder);
    std::fs::create_dir_all(&media).map_err(|error| error.to_string())?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data.trim())
        .map_err(|error| format!("Invalid media payload: {error}"))?;
    let stem = name.trim_end_matches(|c: char| c.is_ascii_alphanumeric() && false);
    let stored = store::unique_path(&media, stem, "img");
    std::fs::write(&stored, bytes).map_err(|error| error.to_string())?;
    Ok(stored
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default())
}

/// Copy a picked file (image or video) into the projects media folder and
/// return the stored file name, so `media://<name>` can serve it.
/// `max_bytes` optionally caps the accepted file size.
#[tauri::command]
pub fn import_media(shared: tauri::State<'_, SharedApp>, path: String, max_bytes: Option<f64>) -> Result<String, String> {
    let folder = folder_of(&shared)?;
    let media = store::media_folder(&folder);
    std::fs::create_dir_all(&media).map_err(|error| error.to_string())?;
    let source = PathBuf::from(&path);
    if !source.is_file() {
        return Err("Media file not found".into());
    }
    if let Some(max) = max_bytes {
        if max > 0.0 {
            let size = std::fs::metadata(&source)
                .map_err(|error| error.to_string())?
                .len();
            if size > max as u64 {
                return Err(format!(
                    "File is too large ({} MB). The limit is {} MB.",
                    (size + 1_048_575) / 1_048_576,
                    (max as u64 + 1_048_575) / 1_048_576
                ));
            }
        }
    }
    let extension = source
        .extension()
        .map(|e| e.to_string_lossy().into_owned())
        .unwrap_or_else(|| "img".into());
    let stem = source
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "media".into());
    let stored = store::unique_path(&media, &stem, &extension);
    std::fs::copy(&source, &stored)
        .map_err(|error| format!("Could not import the media file: {error}"))?;
    Ok(stored
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default())
}

#[tauri::command]
pub fn mcp_status(shared: tauri::State<'_, SharedApp>) -> Status {
    mcp::status(&shared)
}

/// Pipe webview console/error output to the terminal in dev builds.
#[tauri::command]
pub fn log_message(message: String) {
    eprintln!("dupo-webview: {message}");
}

#[tauri::command]
pub fn mcp_start(shared: tauri::State<'_, SharedApp>) -> Result<Status, String> {
    mcp::start(shared.inner().clone())
}

#[tauri::command]
pub fn mcp_stop(shared: tauri::State<'_, SharedApp>) -> Status {
    mcp::stop(&shared);
    mcp::status(&shared)
}

// ---------------------------------------------------------------------------
// Dialogs

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Picked {
    pub path: Option<String>,
    pub canceled: bool,
}

#[tauri::command]
pub async fn pick_folder(title: String) -> Result<Picked, String> {
    use tauri_plugin_dialog::{DialogExt, FilePath};
    let app = app_handle().ok_or_else(|| "The app is not ready yet".to_string())?;
    let (tx, rx) = std::sync::mpsc::channel::<Option<FilePath>>();
    app.dialog()
        .file()
        .set_title(&title)
        .pick_folder(move |file| {
            let _ = tx.send(file);
        });
    let picked = rx.recv().map_err(|e| e.to_string())?;
    Ok(match picked {
        Some(FilePath::Path(path)) => Picked {
            path: Some(path.to_string_lossy().into_owned()),
            canceled: false,
        },
        Some(FilePath::Url(url)) => Picked { path: Some(url.to_string()), canceled: false },
        None => Picked { path: None, canceled: true },
    })
}

#[tauri::command]
pub async fn pick_file(
    title: String,
    extensions: Option<Vec<String>>,
) -> Result<Picked, String> {
    use tauri_plugin_dialog::{DialogExt, FilePath};
    let app = app_handle().ok_or_else(|| "The app is not ready yet".to_string())?;
    let mut builder = app.dialog().file().set_title(&title);
    if let Some(list) = extensions {
        let list: Vec<String> = list
            .iter()
            .map(|e| e.trim_start_matches('.').to_string())
            .collect();
        let refs: Vec<&str> = list.iter().map(|s| s.as_str()).collect();
        builder = builder.add_filter("Files", &refs);
    }
    let (tx, rx) = std::sync::mpsc::channel::<Option<FilePath>>();
    builder.pick_file(move |file| {
        let _ = tx.send(file);
    });
    let picked = rx.recv().map_err(|e| e.to_string())?;
    Ok(match picked {
        Some(FilePath::Path(path)) => Picked {
            path: Some(path.to_string_lossy().into_owned()),
            canceled: false,
        },
        Some(FilePath::Url(url)) => Picked { path: Some(url.to_string()), canceled: false },
        None => Picked { path: None, canceled: true },
    })
}

// ---------------------------------------------------------------------------
// Export: the webview renders each page to base64 PNG; Rust packages them.

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    #[allow(dead_code)] // Reserved for per-project export targeting.
    pub path: String,
    pub format: String,
    pub pages: Vec<String>,
    pub name: Option<String>,
}

#[derive(serde::Serialize)]
pub struct Exported {
    pub saved_to: String,
}

#[tauri::command]
pub async fn export_project(
    shared: tauri::State<'_, SharedApp>,
    request: ExportRequest,
) -> Result<Exported, String> {
    let settings = shared.settings();
    let base_name = request
        .name
        .clone()
        .unwrap_or_else(|| "export".to_string())
        .trim()
        .to_string();
    let base_name = if base_name.is_empty() { "export".to_string() } else { base_name };
    let pages = request.pages.clone();
    let format = request.format.clone();
    let folder = PathBuf::from(settings.projects_folder);
    let saved_to = tauri::async_runtime::spawn_blocking(move || {
        crate::export::export_to(&folder, &base_name, &format, &pages)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(Exported { saved_to })
}
