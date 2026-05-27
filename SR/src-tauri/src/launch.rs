use crate::settings::SrSettings;
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;

pub fn apply_launch_at_startup(app: &AppHandle, settings: &SrSettings) -> Result<(), String> {
    let autolaunch = app.autolaunch();
    if settings.launch_at_startup {
        autolaunch.enable().map_err(|e| format!("开机启动启用失败: {e}"))?;
        crate::debug_log::info("launch_at_startup: enabled");
    } else {
        let _ = autolaunch.disable();
        crate::debug_log::info("launch_at_startup: disabled");
    }
    Ok(())
}
