//! 工具箱内翻译功能的数据目录（与主应用 settings 一致）

use std::path::PathBuf;

pub fn app_data_dir() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("guolicheng-toolbox")
}
