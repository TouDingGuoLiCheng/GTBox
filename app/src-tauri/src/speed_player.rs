use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, State, Url, WebviewUrl};

const BILIBILI_LABEL: &str = "speed-player-bilibili";
const NAV_FIX_SCRIPT: &str = include_str!("../resources/speed_player_nav_fix.js");
const INJECT_SCRIPT: &str = include_str!("../resources/speed_player_inject.js");
const DIAG_SCRIPT: &str = r#"(function(){try{var g=window.__GLC_SPEED_PLAYER__;if(!g)return null;return JSON.stringify(g.getDiagnostics());}catch(e){return JSON.stringify({error:String(e),injected:false});}})()"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedPlayerDiagnostics {
    #[serde(default)]
    pub video_id: Option<String>,
    #[serde(default = "default_rate")]
    pub target_rate: f64,
    pub actual_rate: Option<f64>,
    #[serde(default)]
    pub has_video: bool,
    #[serde(default)]
    pub drift: bool,
    #[serde(default)]
    pub rate_corrections: u32,
    #[serde(default)]
    pub href: Option<String>,
    #[serde(default = "default_true")]
    pub injected: bool,
    #[serde(default)]
    pub error: Option<String>,
}

fn default_rate() -> f64 {
    1.0
}

fn default_true() -> bool {
    true
}

pub struct SpeedPlayerState {
    active_site: Option<String>,
}

impl Default for SpeedPlayerState {
    fn default() -> Self {
        Self { active_site: None }
    }
}

pub fn init_state() -> Mutex<SpeedPlayerState> {
    Mutex::new(SpeedPlayerState::default())
}

fn site_home_url(site: &str) -> Result<Url, String> {
    match site {
        "bilibili" => Url::parse("https://www.bilibili.com/")
            .map_err(|e| format!("解析 B 站地址失败: {e}")),
        other => Err(format!("暂不支持站点: {other}")),
    }
}

fn data_dir_for_site(app: &AppHandle, site: &str) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("读取应用数据目录失败: {e}"))?;
    Ok(base.join("speed-player").join(site))
}

fn reinject_script() -> String {
    let mut s = String::from("try{if(!window.__GLC_SPEED_PLAYER__){");
    s.push_str(INJECT_SCRIPT);
    s.push_str("}else{window.__GLC_SPEED_PLAYER__.refresh();}}catch(e){console.error(e);}");
    s
}

fn reinject(webview: &tauri::Webview) {
    let _ = webview.eval(NAV_FIX_SCRIPT);
    let _ = webview.eval(&reinject_script());
}

fn run_eval_json(webview: &tauri::Webview, script: &str) -> Result<Option<String>, String> {
    let (tx, rx) = mpsc::channel();
    webview
        .eval_with_callback(script.to_string(), move |raw| {
            let _ = tx.send(raw);
        })
        .map_err(|e| format!("执行脚本失败: {e}"))?;

    let raw = rx
        .recv_timeout(Duration::from_secs(3))
        .map_err(|_| "脚本回调超时".to_string())?;

    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed == "null" {
        return Ok(None);
    }
    Ok(Some(trimmed.to_string()))
}

fn parse_diagnostics(raw: &str) -> Result<Option<SpeedPlayerDiagnostics>, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed == "null" {
        return Ok(None);
    }
    serde_json::from_str::<SpeedPlayerDiagnostics>(trimmed)
        .map(Some)
        .map_err(|e| format!("解析诊断信息失败: {e} ({trimmed})"))
}

fn bilibili_webview(app: &AppHandle) -> Option<tauri::Webview> {
    app.get_webview(BILIBILI_LABEL)
}

fn allow_bilibili_navigation(url: &Url) -> bool {
    let host = url.host_str().unwrap_or_default();
    host.eq_ignore_ascii_case("bilibili.com")
        || host.ends_with(".bilibili.com")
        || host.eq_ignore_ascii_case("b23.tv")
}

fn build_webview_builder(app: &AppHandle, data_dir: PathBuf, url: Url) -> WebviewBuilder<tauri::Wry> {
    let app_handle = app.clone();
    WebviewBuilder::new(BILIBILI_LABEL, WebviewUrl::External(url))
        .data_directory(data_dir)
        .initialization_script(NAV_FIX_SCRIPT)
        .on_navigation(|url| allow_bilibili_navigation(url))
        .on_new_window(move |url, _features| {
            if allow_bilibili_navigation(&url) {
                if let Some(wv) = app_handle.get_webview(BILIBILI_LABEL) {
                    let _ = wv.navigate(url);
                }
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .on_page_load(|webview, _payload| {
            reinject(&webview);
        })
}

fn ensure_embedded_webview(
    app: &AppHandle,
    site: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let width = width.max(320.0);
    let height = height.max(240.0);

    if let Some(existing) = bilibili_webview(app) {
        existing
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| format!("设置位置失败: {e}"))?;
        existing
            .set_size(LogicalSize::new(width, height))
            .map_err(|e| format!("设置大小失败: {e}"))?;
        existing
            .set_focus()
            .map_err(|e| format!("聚焦 WebView 失败: {e}"))?;
        reinject(&existing);
        return Ok(());
    }

    let main_window = app
        .get_webview("main")
        .ok_or_else(|| "未找到主 WebView".to_string())?
        .window();

    let url = site_home_url(site)?;
    let data_dir = data_dir_for_site(app, site)?;
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("创建数据目录失败: {e}"))?;

    let child = main_window
        .add_child(
            build_webview_builder(app, data_dir, url),
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| format!("嵌入 B 站 WebView 失败: {e}"))?;

    child
        .set_focus()
        .map_err(|e| format!("聚焦 WebView 失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn speed_player_attach(
    app: AppHandle,
    state: State<'_, Mutex<SpeedPlayerState>>,
    site: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    ensure_embedded_webview(&app, &site, x, y, width, height)?;
    if let Ok(mut guard) = state.lock() {
        guard.active_site = Some(site);
    }
    Ok(())
}

#[tauri::command]
pub async fn speed_player_resize(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let Some(webview) = bilibili_webview(&app) else {
        return Ok(());
    };
    webview
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| format!("设置位置失败: {e}"))?;
    webview
        .set_size(LogicalSize::new(width.max(320.0), height.max(240.0)))
        .map_err(|e| format!("设置大小失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn speed_player_detach(
    app: AppHandle,
    state: State<'_, Mutex<SpeedPlayerState>>,
) -> Result<(), String> {
    if let Some(webview) = bilibili_webview(&app) {
        webview
            .close()
            .map_err(|e| format!("关闭 WebView 失败: {e}"))?;
    }
    if let Ok(mut guard) = state.lock() {
        guard.active_site = None;
    }
    Ok(())
}

#[tauri::command]
pub async fn speed_player_eval(app: AppHandle, script: String) -> Result<(), String> {
    let Some(webview) = bilibili_webview(&app) else {
        return Err("WebView 未打开".to_string());
    };
    webview
        .eval(&script)
        .map_err(|e| format!("执行脚本失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn speed_player_focus(app: AppHandle) -> Result<(), String> {
    let Some(webview) = bilibili_webview(&app) else {
        return Ok(());
    };
    webview
        .set_focus()
        .map_err(|e| format!("聚焦 WebView 失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn speed_player_diagnostics(
    app: AppHandle,
) -> Result<Option<SpeedPlayerDiagnostics>, String> {
    let Some(webview) = bilibili_webview(&app) else {
        return Ok(None);
    };
    let raw = run_eval_json(&webview, DIAG_SCRIPT)?;
    let Some(raw) = raw else {
        return Ok(None);
    };
    parse_diagnostics(&raw)
}

#[tauri::command]
pub async fn speed_player_send_action(app: AppHandle, action: String) -> Result<(), String> {
    let script = match action.as_str() {
        "rate-dec" => "window.__GLC_SPEED_PLAYER__?.nudgeRate(-0.05)",
        "rate-inc" => "window.__GLC_SPEED_PLAYER__?.nudgeRate(0.05)",
        "set-a" => "window.__GLC_SPEED_PLAYER__?.setPointA()",
        "set-b" => "window.__GLC_SPEED_PLAYER__?.setPointB()",
        "toggle-ab" => "window.__GLC_SPEED_PLAYER__?.toggleAb()",
        "clear-ab" => "window.__GLC_SPEED_PLAYER__?.clearAb()",
        "add-marker" => "window.__GLC_SPEED_PLAYER__?.addMarker()",
        other => return Err(format!("未知动作: {other}")),
    };
    speed_player_eval(app, format!("try{{{script}}}catch(e){{}}")).await
}
