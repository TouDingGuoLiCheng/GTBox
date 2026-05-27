mod debug_log;
mod app_data;
mod appearance;
mod asr_daemon;
mod audio;
mod focus;
mod launch;
mod model_path;
mod overlay;
mod session;
mod settings;
mod text_inject;
mod window_layout;
mod window_util;

use session::SessionManager;
use settings::SrSettings;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const TRAY_ID: &str = "sr-tray";
const WINDOW_LABEL: &str = "main";

static APP_QUIT_REQUESTED: AtomicBool = AtomicBool::new(false);

struct AppState {
    settings: Mutex<SrSettings>,
    sessions: Arc<SessionManager>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_settings = settings::load();
    debug_log::init_session(initial_settings.clear_log_on_startup);
    debug_log::info(format!("SR starting, exe={:?}", std::env::current_exe().ok()));
    asr_daemon::copy_script_to_resources();
    let setup_settings = initial_settings.clone();
    let sessions = Arc::new(SessionManager::new());

    tauri::Builder::default()
        .manage(AppState {
            settings: Mutex::new(initial_settings),
            sessions: sessions.clone(),
        })
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler({
                    let sessions = sessions.clone();
                    move |app, shortcut, event| {
                        crate::debug_log::info(format!(
                            "global shortcut: {:?} state={:?}",
                            shortcut,
                            event.state
                        ));
                        let state = app.state::<AppState>();
                        let settings = state
                            .settings
                            .lock()
                            .map(|g| g.clone())
                            .unwrap_or_default();
                        if !settings.enabled {
                            crate::debug_log::warn("shortcut ignored: SR disabled");
                            return;
                        }
                        if shortcut_matches(shortcut, &settings.confirm_hotkey) {
                            if matches!(event.state, ShortcutState::Pressed) {
                                session::on_confirm_hotkey(
                                    app.clone(),
                                    sessions.clone(),
                                    settings,
                                );
                            }
                            return;
                        }
                        if !shortcut_matches(shortcut, &settings.hotkey) {
                            return;
                        }
                        match event.state {
                            ShortcutState::Pressed => {
                                session::on_hotkey_pressed(
                                    app.clone(),
                                    sessions.clone(),
                                    settings,
                                );
                            }
                            ShortcutState::Released => {
                                let settings = state
                                    .settings
                                    .lock()
                                    .map(|g| g.clone())
                                    .unwrap_or_default();
                                session::on_hotkey_released(
                                    app.clone(),
                                    sessions.clone(),
                                    settings,
                                );
                            }
                        }
                    }
                })
                .build(),
        )
        .setup({
            let sessions = sessions.clone();
            move |app| {
                setup_tray(app)?;
                register_hotkeys(app.handle(), &setup_settings)?;
                asr_daemon::log_bundle_probe(app.handle());
                launch::apply_launch_at_startup(app.handle(), &setup_settings)?;
                let app_handle = app.handle().clone();
                session::start_engine(app_handle, sessions, setup_settings);
                Ok(())
            }
        })
        .invoke_handler(tauri::generate_handler![
            sr_get_settings,
            sr_save_settings,
            sr_engine_status,
            sr_restart_engine,
            sr_list_audio_devices,
            sr_test_overlay,
            sr_hide_to_tray,
            sr_hide_overlay,
            sr_write_session,
            sr_enter_manual_edit,
            sr_exit_manual_edit,
            sr_confirm_session,
            sr_cancel_session,
            sr_sync_overlay_text,
            sr_overlay_set_height,
            sr_overlay_set_position,
            sr_overlay_bootstrap,
            sr_debug_log_path,
            sr_read_debug_log,
            sr_clear_debug_log,
            pick_overlay_background,
            clear_overlay_background,
            get_overlay_background_data_url,
            read_image_data_url,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == WINDOW_LABEL {
                    api.prevent_close();
                    window_util::destroy_webview_window(window.app_handle(), WINDOW_LABEL);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building SR app")
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !APP_QUIT_REQUESTED.load(Ordering::SeqCst) {
                    api.prevent_exit();
                }
            }
        });
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show_i = MenuItem::with_id(app, "show", "打开设置", true, None::<&str>)?;
    let restart_i = MenuItem::with_id(app, "restart", "重启识别引擎", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_i, &restart_i, &quit_i])?;

    let icon = app
        .default_window_icon()
        .ok_or_else(|| tauri::Error::FailedToReceiveMessage)?
        .clone();

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("SR · 语音输入")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "restart" => {
                let state = app.state::<AppState>();
                let settings = state
                    .settings
                    .lock()
                    .map(|g| g.clone())
                    .unwrap_or_default();
                session::restart_engine(app.clone(), state.sessions.clone(), settings);
            }
            "quit" => {
                APP_QUIT_REQUESTED.store(true, Ordering::SeqCst);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn show_main_window(app: &tauri::AppHandle) {
    let window = match window_util::ensure_webview_window(app, WINDOW_LABEL) {
        Ok(w) => w,
        Err(e) => {
            crate::debug_log::warn(format!("show_main_window: {e}"));
            return;
        }
    };
    let _ = window_layout::place_main_above_tray(&window);
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

fn shortcut_matches(
    pressed: &tauri_plugin_global_shortcut::Shortcut,
    accelerator: &str,
) -> bool {
    accelerator
        .parse::<tauri_plugin_global_shortcut::Shortcut>()
        .ok()
        .as_ref()
        == Some(pressed)
}

fn register_hotkeys(app: &tauri::AppHandle, settings: &SrSettings) -> Result<(), String> {
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| format!("注销快捷键失败: {e}"))?;
    if !settings.enabled {
        return Ok(());
    }
    let record = settings
        .hotkey
        .parse::<tauri_plugin_global_shortcut::Shortcut>()
        .map_err(|e| format!("无效说话快捷键 {}: {e}", settings.hotkey))?;
    app.global_shortcut()
        .register(record)
        .map_err(|e| format!("注册说话快捷键失败: {e}"))?;
    crate::debug_log::info(format!("hotkey registered: {}", settings.hotkey));

    if settings.confirm_hotkey != settings.hotkey {
        let confirm = settings
            .confirm_hotkey
            .parse::<tauri_plugin_global_shortcut::Shortcut>()
            .map_err(|e| format!("无效写入快捷键 {}: {e}", settings.confirm_hotkey))?;
        app.global_shortcut()
            .register(confirm)
            .map_err(|e| format!("注册写入快捷键失败: {e}"))?;
        crate::debug_log::info(format!("confirm hotkey registered: {}", settings.confirm_hotkey));
    }
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineStatusDto {
    state: String,
    message: Option<String>,
}

#[tauri::command]
fn sr_debug_log_path() -> String {
    debug_log::log_path().to_string_lossy().into_owned()
}

#[tauri::command]
fn sr_clear_debug_log() -> Result<(), String> {
    debug_log::clear()
}

#[tauri::command]
fn sr_read_debug_log(max_lines: Option<usize>) -> Result<String, String> {
    let path = debug_log::log_path();
    let text = std::fs::read_to_string(&path).map_err(|e| format!("读取日志失败: {e}"))?;
    let keep = max_lines.unwrap_or(200);
    let lines: Vec<&str> = text.lines().collect();
    if lines.len() <= keep {
        Ok(text)
    } else {
        Ok(lines[lines.len() - keep..].join("\n"))
    }
}

#[tauri::command]
fn sr_get_settings(state: State<'_, AppState>) -> SrSettings {
    state
        .settings
        .lock()
        .map(|g| settings::prepare(g.clone()))
        .unwrap_or_default()
}

#[tauri::command]
fn sr_save_settings(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    settings: SrSettings,
) -> Result<(), String> {
    let settings = settings::prepare(settings);
    let prev = state
        .settings
        .lock()
        .map(|g| g.clone())
        .unwrap_or_default();
    let layout_changed = prev.overlay_placement != settings.overlay_placement
        || prev.overlay_edge_margin != settings.overlay_edge_margin
        || prev.overlay_tray_gap != settings.overlay_tray_gap;
    settings::save(&settings)?;
    if let Ok(mut guard) = state.settings.lock() {
        *guard = settings.clone();
    }
    register_hotkeys(&app, &settings)?;
    launch::apply_launch_at_startup(&app, &settings)?;
    let engine_needs_restart = prev.model_dir != settings.model_dir
        || prev.asr_engine != settings.asr_engine
        || (settings::is_valid_model_dir(&settings.model_dir)
            && !settings::is_valid_model_dir(&prev.model_dir));
    if engine_needs_restart {
        session::restart_engine(app.clone(), state.sessions.clone(), settings.clone());
    }
    if layout_changed {
        overlay::clear_cached_position();
    }
    let _ = app.emit("settings:updated", &settings);
    overlay::reposition_if_visible(&app, &settings);
    Ok(())
}

#[tauri::command]
fn sr_hide_to_tray(app: tauri::AppHandle) -> Result<(), String> {
    window_util::destroy_webview_window(&app, WINDOW_LABEL);
    Ok(())
}

#[tauri::command]
fn sr_engine_status(state: State<'_, AppState>) -> EngineStatusDto {
    let (state_name, message) = state.sessions.engine_status();
    EngineStatusDto {
        state: state_name,
        message,
    }
}

#[tauri::command]
fn sr_restart_engine(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    settings: SrSettings,
) -> Result<(), String> {
    let settings = settings::prepare(settings);
    settings::save(&settings)?;
    if let Ok(mut guard) = state.settings.lock() {
        *guard = settings.clone();
    }
    register_hotkeys(&app, &settings)?;
    session::restart_engine(app.clone(), state.sessions.clone(), settings.clone());
    let _ = app.emit("settings:updated", &settings);
    Ok(())
}

#[tauri::command]
fn sr_list_audio_devices() -> Result<Vec<audio::AudioDeviceInfo>, String> {
    audio::list_input_devices()
}

#[tauri::command]
fn sr_hide_overlay(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    crate::debug_log::info("sr_hide_overlay: invoked (hide first, reset in background)");
    overlay::hide(&app);
    crate::debug_log::info("sr_hide_overlay: overlay window hidden");
    let manager = state.sessions.clone();
    let app_bg = app.clone();
    std::thread::spawn(move || {
        session::reset_overlay_session(&app_bg, &manager);
        crate::debug_log::info("sr_hide_overlay: background reset finished");
    });
    Ok(())
}

#[tauri::command]
fn sr_write_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    text: Option<String>,
) -> Result<(), String> {
    let settings = state
        .settings
        .lock()
        .map(|g| g.clone())
        .map_err(|e| e.to_string())?;
    session::write_overlay_text(app.clone(), state.sessions.clone(), settings, text)
}

#[tauri::command]
fn sr_enter_manual_edit(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    text: Option<String>,
) -> Result<(), String> {
    session::enter_manual_edit(&app, &state.sessions, text)
}

#[tauri::command]
fn sr_exit_manual_edit(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    text: Option<String>,
) -> Result<(), String> {
    session::exit_manual_edit(&app, &state.sessions, text)
}

#[tauri::command]
fn sr_confirm_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    text: Option<String>,
) -> Result<(), String> {
    sr_write_session(app, state, text)
}

#[tauri::command]
fn sr_sync_overlay_text(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    text: String,
) -> Result<(), String> {
    state.sessions.sync_overlay_text(&app, text);
    Ok(())
}

#[tauri::command]
fn sr_overlay_set_height(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    height: f64,
) -> Result<f64, String> {
    let settings = state
        .settings
        .lock()
        .map(|g| g.clone())
        .map_err(|e| e.to_string())?;
    overlay::resize_and_reposition(&app, &settings, height)
}

#[tauri::command]
fn sr_overlay_set_position(state: State<'_, AppState>, x: i32, y: i32) -> Result<(), String> {
    let _ = state;
    overlay::set_cached_position(x, y);
    Ok(())
}

#[tauri::command]
fn sr_cancel_session(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    session::reset_overlay_session(&app, &state.sessions);
    overlay::hide(&app);
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OverlayBootstrapDto {
    ui: overlay::OverlayUiState,
    settings: SrSettings,
    background_data_url: Option<String>,
}

#[tauri::command]
fn sr_overlay_bootstrap(state: State<'_, AppState>) -> Result<OverlayBootstrapDto, String> {
    let settings = state
        .settings
        .lock()
        .map(|g| settings::prepare(g.clone()))
        .map_err(|e| e.to_string())?;
    let ui = state
        .sessions
        .overlay_ui
        .lock()
        .map(|g| g.clone())
        .map_err(|e| e.to_string())?;
    Ok(OverlayBootstrapDto {
        ui,
        settings: settings.clone(),
        background_data_url: appearance::overlay_background_data_url(&settings),
    })
}

#[tauri::command]
fn sr_test_overlay(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let settings = state
        .settings
        .lock()
        .map(|g| g.clone())
        .map_err(|e| e.to_string())?;
    overlay::show_test(&app, &settings)?;
    state.sessions.set_overlay_ui(
        &app,
        overlay::OverlayUiState {
            phase: "editing".to_string(),
            display_text: "测试识别文字，可编辑".to_string(),
            session_id: "test".to_string(),
        },
    );
    overlay::emit_session_start(&app, "test");
    Ok(())
}

#[tauri::command]
fn pick_overlay_background() -> Result<appearance::PickBackgroundResult, String> {
    appearance::pick_and_save_overlay_background()
}

#[tauri::command]
fn clear_overlay_background() -> Result<(), String> {
    appearance::clear_overlay_background_files()
}

#[tauri::command]
fn get_overlay_background_data_url(state: State<'_, AppState>) -> Option<String> {
    let settings = state.settings.lock().ok()?;
    appearance::overlay_background_data_url(&settings)
}

#[tauri::command]
fn read_image_data_url(path: String) -> Option<String> {
    appearance::path_to_data_url(std::path::Path::new(&path))
}
