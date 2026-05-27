use std::path::PathBuf;

pub const APP_DIR_NAME: &str = "GLC Speech Input";

fn dir_name() -> &'static str {
    if cfg!(debug_assertions) {
        "果粒橙工具箱"
    } else {
        APP_DIR_NAME
    }
}

pub fn app_data_dir() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(dir_name())
}

pub fn settings_path() -> PathBuf {
    app_data_dir().join("sr-settings.json")
}

/// 仓库根目录（开发时从 `SR/src-tauri` 向上两级）
pub fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))
}

pub fn workspaces_sr_asr() -> PathBuf {
    repo_root().join("workspaces").join("sr_asr")
}
