use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

/// 按 tauri.conf.json 延迟创建 WebView（`create: false`），降低托盘待机内存。
pub fn ensure_webview_window<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
) -> Result<WebviewWindow<R>, String> {
    if let Some(w) = app.get_webview_window(label) {
        return Ok(w);
    }
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == label)
        .ok_or_else(|| format!("tauri.conf 中缺少窗口配置: {label}"))?;
    tauri::WebviewWindowBuilder::from_config(app, config)
        .map_err(|e| format!("创建窗口 {label} 失败: {e}"))?
        .visible(false)
        .build()
        .map_err(|e| format!("创建窗口 {label} 失败: {e}"))
}

/// 销毁 WebView（用 `destroy` 而非 `close`，避免 CloseRequested + prevent_close 无法释放内存）。
pub fn destroy_webview_window<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.destroy();
    }
}
