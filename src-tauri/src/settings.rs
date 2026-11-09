//! Persistent settings, stored at ~/.dupo/settings.json.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

pub const DEFAULT_PORT: u16 = 47330;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub projects_folder: String,
    pub theme: String,
    pub mcp_enabled: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            projects_folder: default_projects_folder(),
            theme: "dark".to_string(),
            mcp_enabled: false,
        }
    }
}

fn default_projects_folder() -> String {
    if let Some(docs) = dirs::documents() {
        return docs.join("Dupo").to_string_lossy().into_owned();
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Dupo")
        .to_string_lossy()
        .into_owned()
}

pub fn settings_path() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".dupo/settings.json")
}

impl Settings {
    pub fn load() -> Settings {
        let path = settings_path();
        let raw = match fs::read_to_string(&path) {
            Ok(raw) => raw,
            Err(_) => return Settings::default(),
        };
        match serde_json::from_str::<Settings>(&raw) {
            Ok(mut settings) => {
                if settings.projects_folder.trim().is_empty() {
                    settings.projects_folder = default_projects_folder();
                }
                settings
            }
            Err(_) => Settings::default(),
        }
    }

    pub fn save(&self) -> Result<(), String> {
        let path = settings_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let raw = serde_json::to_string_pretty(self).map_err(|error| error.to_string())?;
        fs::write(path, raw).map_err(|error| error.to_string())
    }
}

// Minimal dirs helpers (avoid an extra dependency).
mod dirs {
    use std::path::PathBuf;

    pub fn home_dir() -> Option<PathBuf> {
        std::env::var_os("HOME")
            .or_else(|| std::env::var_os("USERPROFILE"))
            .map(PathBuf::from)
    }

    pub fn documents() -> Option<PathBuf> {
        #[cfg(target_os = "macos")]
        {
            let home = home_dir()?;
            let docs = home.join("Documents");
            if docs.is_dir() {
                return Some(docs);
            }
            return None;
        }
        #[cfg(not(target_os = "macos"))]
        {
            let home = home_dir()?;
            let docs = home.join("Documents");
            if docs.is_dir() {
                return Some(docs);
            }
            None
        }
    }
}
