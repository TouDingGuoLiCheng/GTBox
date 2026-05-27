use crate::appearance;
use crate::settings::SrSettings;
use crate::window_layout;
use std::sync::{Mutex, OnceLock};
use serde::Serialize;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Size, WebviewWindow};

pub const OVERLAY_LABEL: &str = "sr-overlay";

/// 与前端 overlayLayout.ts / overlay-layout-vars.css 一致
pub const OVERLAY_WIDTH: f64 = 336.0;
pub const OVERLAY_FOOTER_HEIGHT: f64 = 52.0;
pub const OVERLAY_MAX_TEXT_HEIGHT: f64 = 108.0;
pub const OVERLAY_MAX_HEIGHT: f64 = OVERLAY_FOOTER_HEIGHT + OVERLAY_MAX_TEXT_HEIGHT;

static OVERLAY_HEIGHT_STATE: OnceLock<Mutex<f64>> = OnceLock::new();
static OVERLAY_POSITION_STATE: OnceLock<Mutex<Option<(i32, i32)>>> = OnceLock::new();

fn overlay_height_store() -> &'static Mutex<f64> {
    OVERLAY_HEIGHT_STATE.get_or_init(|| Mutex::new(OVERLAY_FOOTER_HEIGHT))
}

fn overlay_position_store() -> &'static Mutex<Option<(i32, i32)>> {
    OVERLAY_POSITION_STATE.get_or_init(|| Mutex::new(None))
}

pub fn current_overlay_height() -> f64 {
    overlay_height_store()
        .lock()
        .map(|g| *g)
        .unwrap_or(OVERLAY_FOOTER_HEIGHT)
}

pub fn set_overlay_height(height: f64) -> f64 {
    let clamped = height
        .clamp(OVERLAY_FOOTER_HEIGHT, OVERLAY_MAX_HEIGHT)
        .round();
    if let Ok(mut guard) = overlay_height_store().lock() {
        *guard = clamped;
    }
    clamped
}

pub fn cached_position() -> Option<(i32, i32)> {
    overlay_position_store().lock().ok().and_then(|g| *g)
}

pub fn set_cached_position(x: i32, y: i32) {
    if let Ok(mut guard) = overlay_position_store().lock() {
        *guard = Some((x, y));
    }
}

pub fn clear_cached_position() {
    if let Ok(mut guard) = overlay_position_store().lock() {
        *guard = None;
    }
}

/// 兼容旧引用
pub const OVERLAY_HEIGHT: f64 = OVERLAY_FOOTER_HEIGHT;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayUiState {
    pub phase: String,
    pub display_text: String,
    pub session_id: String,
}

impl Default for OverlayUiState {
    fn default() -> Self {
        Self {
            phase: "listening".to_string(),
            display_text: String::new(),
            session_id: String::new(),
        }
    }
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OverlayAppearancePayload {
    pub app_theme: String,
    pub overlay_opacity: u8,
    pub overlay_bg_layout: crate::settings::OverlayBgLayout,
    pub overlay_text_color: String,
    pub overlay_wave_color: String,
    pub background_data_url: Option<String>,
}

impl OverlayAppearancePayload {
    pub fn from_settings(settings: &SrSettings) -> Self {
        Self {
            app_theme: settings.app_theme.clone(),
            overlay_opacity: settings.overlay_opacity,
            overlay_bg_layout: settings.overlay_bg_layout.clone(),
            overlay_text_color: settings.overlay_text_color.clone(),
            overlay_wave_color: settings.overlay_wave_color.clone(),
            background_data_url: appearance::overlay_background_data_url(settings),
        }
    }
}

fn emit_overlay<T: Serialize + Clone>(app: &AppHandle, event: &str, payload: T) {
    let _ = app.emit_to(OVERLAY_LABEL, event, payload);
}

fn overlay_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(OVERLAY_LABEL)
}


fn monitor_scale(window: &WebviewWindow) -> f64 {
    window
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .or_else(|| {
            window
                .primary_monitor()
                .ok()
                .flatten()
                .map(|m| m.scale_factor())
        })
        .unwrap_or(1.0)
}

pub fn set_ui_state(app: &AppHandle, state: OverlayUiState) {
    emit_overlay(app, "sr:overlay-state", state);
}

pub fn emit_appearance(app: &AppHandle, settings: &SrSettings) {
    let payload = OverlayAppearancePayload::from_settings(settings);
    emit_overlay(app, "sr:overlay-appearance", payload);
}

pub fn show(app: &AppHandle, settings: &SrSettings) -> Result<(), String> {
    show_with_placement(app, settings, None)
}

pub fn show_test(app: &AppHandle, settings: &SrSettings) -> Result<(), String> {
    show_with_placement(app, settings, Some("center"))
}

fn show_with_placement(
    app: &AppHandle,
    settings: &SrSettings,
    placement_override: Option<&str>,
) -> Result<(), String> {
    let window = ensure_overlay(app)?;
    place_overlay(&window, settings, placement_override)?;
    window
        .set_always_on_top(true)
        .map_err(|e| format!("置顶 overlay 失败: {e}"))?;
    window.show().map_err(|e| format!("显示 overlay 失败: {e}"))?;
    if placement_override == Some("center") {
        let _ = window.set_focus();
    }
    emit_appearance(app, settings);
    Ok(())
}

pub fn resize_and_reposition(
    app: &AppHandle,
    settings: &SrSettings,
    height: f64,
) -> Result<f64, String> {
    let height = set_overlay_height(height);
    let Some(window) = overlay_window(app) else {
        return Ok(height);
    };
    place_overlay(&window, settings, None)?;
    Ok(height)
}

pub fn is_visible(app: &AppHandle) -> bool {
    overlay_window(app)
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false)
}

pub fn hide(app: &AppHandle) {
    crate::debug_log::info("overlay::hide: begin");
    set_overlay_height(OVERLAY_FOOTER_HEIGHT);
    if overlay_window(app).is_some() {
        crate::window_util::destroy_webview_window(app, OVERLAY_LABEL);
        crate::debug_log::info("overlay::hide: window destroyed");
    } else {
        crate::debug_log::warn("overlay::hide: no overlay window");
    }
}

pub fn reposition_if_visible(app: &AppHandle, settings: &SrSettings) {
    let Some(window) = overlay_window(app) else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = place_overlay(&window, settings, None);
    }
}

fn ensure_overlay(app: &AppHandle) -> Result<WebviewWindow, String> {
    crate::window_util::ensure_webview_window(app, OVERLAY_LABEL)
}

fn place_overlay(
    window: &WebviewWindow,
    settings: &SrSettings,
    placement_override: Option<&str>,
) -> Result<(), String> {
    let placement = placement_override.unwrap_or(settings.overlay_placement.as_str());
    let scale = monitor_scale(window);
    let win_w = (OVERLAY_WIDTH * scale).round() as u32;
    let win_h = (current_overlay_height() * scale).round() as u32;

    let (area_x, area_y, area_w, area_h) = window_layout::monitor_work_area_near_cursor()?;
    let margin = settings.overlay_edge_margin as i32;
    let tray_gap = settings.overlay_tray_gap as i32;

    let custom_target = if placement_override.is_none() {
        cached_position()
    } else {
        None
    };
    let (x, y) = if let Some(custom) = custom_target {
        custom
    } else {
        let mut pos = match placement {
            "bottom-right" => (
                area_x + area_w - win_w as i32 - margin,
                area_y + area_h - win_h as i32 - margin - tray_gap,
            ),
            "bottom-left" => (
                area_x + margin,
                area_y + area_h - win_h as i32 - margin - tray_gap,
            ),
            "top-center" => (
                area_x + (area_w - win_w as i32) / 2,
                area_y + margin,
            ),
            "top-right" => (
                area_x + area_w - win_w as i32 - margin,
                area_y + margin,
            ),
            "top-left" => (area_x + margin, area_y + margin),
            "center" => (
                area_x + (area_w - win_w as i32) / 2,
                area_y + (area_h - win_h as i32) / 2,
            ),
            _ => (
                area_x + (area_w - win_w as i32) / 2,
                area_y + area_h - win_h as i32 - margin - tray_gap,
            ),
        };
        let max_x = area_x + area_w - win_w as i32;
        let max_y = area_y + area_h - win_h as i32;
        pos.0 = pos.0.clamp(area_x, max_x.max(area_x));
        pos.1 = pos.1.clamp(area_y, max_y.max(area_y));
        pos
    };

    window
        .set_size(Size::Logical(LogicalSize::new(
            OVERLAY_WIDTH,
            current_overlay_height(),
        )))
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn emit_level(app: &AppHandle, rms: f32) {
    emit_overlay(app, "sr:level", serde_json::json!({ "rms": rms }));
}

pub fn emit_partial(app: &AppHandle, session_id: &str, text: &str) {
    emit_overlay(
        app,
        "sr:partial",
        serde_json::json!({ "sessionId": session_id, "text": text }),
    );
}

pub fn emit_session_start(app: &AppHandle, session_id: &str) {
    emit_overlay(
        app,
        "sr:session-start",
        serde_json::json!({ "sessionId": session_id }),
    );
}

pub fn emit_session_end(
    app: &AppHandle,
    session_id: &str,
    ok: bool,
    text: Option<&str>,
    error: Option<&str>,
) {
    emit_overlay(
        app,
        "sr:session-end",
        serde_json::json!({
            "sessionId": session_id,
            "ok": ok,
            "text": text,
            "error": error,
        }),
    );
}

pub fn emit_manual_edit_enter(app: &AppHandle, session_id: &str, text: &str) {
    emit_overlay(
        app,
        "sr:manual-edit-enter",
        serde_json::json!({
            "sessionId": session_id,
            "text": text,
        }),
    );
}

pub fn emit_manual_edit_exit(app: &AppHandle, session_id: &str, text: &str) {
    emit_overlay(
        app,
        "sr:manual-edit-exit",
        serde_json::json!({
            "sessionId": session_id,
            "text": text,
        }),
    );
}

pub fn emit_session_reset(app: &AppHandle) {
    emit_overlay(app, "sr:session-reset", serde_json::json!({}));
}

pub fn emit_text_written(app: &AppHandle, session_id: &str, text: &str) {
    emit_overlay(
        app,
        "sr:text-written",
        serde_json::json!({
            "sessionId": session_id,
            "text": text,
        }),
    );
}

pub fn emit_write_result(
    app: &AppHandle,
    session_id: &str,
    ok: bool,
    error: Option<&str>,
) {
    emit_overlay(
        app,
        "sr:write-result",
        serde_json::json!({
            "sessionId": session_id,
            "ok": ok,
            "error": error,
        }),
    );
}

pub fn emit_engine(app: &AppHandle, state: &str, message: Option<&str>) {
    let _ = app.emit(
        "sr:engine",
        serde_json::json!({ "state": state, "message": message }),
    );
}
