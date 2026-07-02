use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// 工具箱翻译页可配置项（不含气泡/外观/热键等独立版专属项）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TranslateSettings {
    pub target_lang: String,
    pub primary_provider: String,
    pub fallback_enabled: bool,
    pub timeout_sec: u64,
    pub cache_ttl_sec: u64,
    #[serde(default = "default_history_max")]
    pub history_max_count: u32,
}

fn default_history_max() -> u32 {
    200
}

impl Default for TranslateSettings {
    fn default() -> Self {
        Self {
            target_lang: "auto".to_string(),
            primary_provider: "baidu".to_string(),
            fallback_enabled: true,
            timeout_sec: 20,
            cache_ttl_sec: 30,
            history_max_count: default_history_max(),
        }
    }
}

pub fn clamp_history_max(count: u32) -> u32 {
    count.clamp(20, 500)
}

pub fn normalize_primary_provider(id: &str) -> String {
    if id == "google" {
        "baidu".to_string()
    } else {
        id.to_string()
    }
}

pub fn normalize_settings(mut s: TranslateSettings) -> TranslateSettings {
    s.primary_provider = normalize_primary_provider(&s.primary_provider);
    s.history_max_count = clamp_history_max(s.history_max_count);
    s.timeout_sec = s.timeout_sec.clamp(3, 60);
    s.cache_ttl_sec = s.cache_ttl_sec.clamp(5, 3600);
    s
}

pub fn config_path() -> PathBuf {
    super::app_data::app_data_dir().join("translate-toolbox.json")
}

pub fn load() -> TranslateSettings {
    let path = config_path();
    if !path.exists() {
        return TranslateSettings::default();
    }
    match fs::read_to_string(&path) {
        Ok(raw) => {
            let s: TranslateSettings = serde_json::from_str(&raw).unwrap_or_default();
            normalize_settings(s)
        }
        Err(_) => TranslateSettings::default(),
    }
}

pub fn save(settings: &TranslateSettings) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}
