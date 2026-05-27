use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;

/// sherpa-onnx 在 Windows 上无法正确处理含非 ASCII 字符的模型路径（tokens 解析失败）。
/// 若路径含中文等字符，则建立 ASCII 目录联接（junction）后再交给 Python 引擎。
pub fn resolve_for_sherpa(model_dir: &str) -> Result<String, String> {
    let trimmed = model_dir.trim();
    if trimmed.is_empty() {
        return Err("模型目录为空".to_string());
    }

    let canonical = std::fs::canonicalize(trimmed)
        .map_err(|e| format!("无法访问模型目录 {trimmed}: {e}"))?;

    if !crate::settings::is_valid_model_dir(canonical.to_string_lossy().as_ref()) {
        return Err(format!("模型目录无效（需包含 tokens.txt）: {trimmed}"));
    }

    let path_str = canonical.to_string_lossy();
    if path_str.is_ascii() {
        crate::debug_log::info(format!("model path ascii ok: {path_str}"));
        return Ok(path_str.into_owned());
    }

    crate::debug_log::info(format!("model path non-ascii, creating junction: {path_str}"));

    #[cfg(windows)]
    {
        let link = ensure_ascii_junction(&canonical)?;
        crate::debug_log::info(format!("model junction ready: {link}"));
        return Ok(link);
    }

    #[cfg(not(windows))]
    {
        Ok(path_str.into_owned())
    }
}

#[cfg(windows)]
fn ensure_ascii_junction(target: &Path) -> Result<String, String> {
    let cache_root = ascii_link_cache_dir();
    std::fs::create_dir_all(&cache_root)
        .map_err(|e| format!("创建模型联接缓存目录失败: {e}"))?;

    let base = target
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("model");
    let mut hasher = DefaultHasher::new();
    target.hash(&mut hasher);
    let tag = format!("{:08x}", hasher.finish());
    let link_name = format!("{base}-{tag}");
    let link_path = cache_root.join(link_name);

    if link_path.is_dir() {
        if link_path.join("tokens.txt").is_file() {
            return Ok(link_path.to_string_lossy().into_owned());
        }
        std::fs::remove_dir(&link_path).map_err(|e| format!("清理旧模型联接失败: {e}"))?;
    }

    create_junction(&link_path, target)?;
    if !link_path.join("tokens.txt").is_file() {
        return Err("模型目录联接已创建，但无法读取 tokens.txt".to_string());
    }
    Ok(link_path.to_string_lossy().into_owned())
}

#[cfg(windows)]
fn ascii_link_cache_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(crate::app_data::app_data_dir)
        .join(crate::app_data::APP_DIR_NAME)
        .join("asr-model-links")
}

#[cfg(windows)]
fn create_junction(link: &Path, target: &Path) -> Result<(), String> {
    let status = Command::new("cmd")
        .args([
            "/C",
            "mklink",
            "/J",
            &link.to_string_lossy(),
            &target.to_string_lossy(),
        ])
        .status()
        .map_err(|e| format!("创建模型目录联接失败: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "创建模型目录联接失败（{} → {}）。\
             可将模型复制到纯英文路径后在设置中指定，例如 C:\\Models\\sherpa-onnx",
            link.display(),
            target.display()
        ))
    }
}
