//! Project store: a folder of .dupo JSON files, plus a media/ subfolder for
//! images and videos the editor references.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub path: String,
    pub width: f64,
    pub height: f64,
    pub updated_at: u64,
}

/// Read the kind/dimensions of a .dupo file without fully parsing it.
fn probe(raw: &str) -> Option<(String, String, f64, f64)> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    let kind = value.get("kind")?.as_str()?.to_string();
    let name = value.get("name")?.as_str()?.to_string();
    let width = value.get("width")?.as_f64()?;
    let height = value.get("height")?.as_f64()?;
    if kind != "documents" && kind != "presentations" && kind != "videos" {
        return None;
    }
    Some((kind, name, width, height))
}

pub fn scan(folder: &Path) -> Vec<ProjectMeta> {
    let mut projects = Vec::new();
    let entries = match fs::read_dir(folder) {
        Ok(entries) => entries,
        Err(_) => return projects,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("dupo") {
            continue;
        }
        let raw = match fs::read_to_string(&path) {
            Ok(raw) => raw,
            Err(_) => continue,
        };
        let Some((kind, name, width, height)) = probe(&raw) else {
            continue;
        };
        let updated_at = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        projects.push(ProjectMeta {
            id: path.to_string_lossy().into_owned(),
            kind,
            name,
            path: path.to_string_lossy().into_owned(),
            width,
            height,
            updated_at,
        });
    }
    projects.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    projects
}

pub fn ensure_folder(folder: &Path) -> Result<(), String> {
    fs::create_dir_all(folder).map_err(|error| format!("Could not create the projects folder: {error}"))
}

pub fn media_folder(folder: &Path) -> PathBuf {
    folder.join("media")
}

pub fn unique_path(folder: &Path, name: &str, extension: &str) -> PathBuf {
    let clean: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' { c } else { '-' })
        .collect();
    let clean = clean.trim().trim_matches('-').replace(' ', "-");
    let clean = if clean.is_empty() { "project".to_string() } else { clean };
    let mut candidate = folder.join(format!("{clean}.{extension}"));
    let mut count = 2;
    while candidate.exists() {
        candidate = folder.join(format!("{clean}-{count}.{extension}"));
        count += 1;
    }
    candidate
}

pub fn now_id(prefix: &str) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    format!("{prefix}{nanos:x}")
}
