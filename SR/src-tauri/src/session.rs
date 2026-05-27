use crate::asr_daemon::AsrDaemon;
use crate::audio::AudioCapture;
use crate::focus::TargetHwnd;
use crate::overlay;
use crate::settings::SrSettings;
use crate::text_inject;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use uuid::Uuid;

const VOICE_RMS: f32 = 0.032;

pub enum EngineState {
    Idle,
    Loading,
    Ready,
    Error(String),
}

impl std::fmt::Debug for EngineState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EngineState::Idle => write!(f, "idle"),
            EngineState::Loading => write!(f, "loading"),
            EngineState::Ready => write!(f, "ready"),
            EngineState::Error(s) => write!(f, "error({s})"),
        }
    }
}

struct ActiveRecording {
    session_id: String,
    target: TargetHwnd,
    capture: Option<AudioCapture>,
    /// 已确认的前缀（含用户编辑、上一段识别）
    segment_base: String,
    last_partial: String,
    has_received_text: bool,
    manual_editing: bool,
    chunk_count: u32,
    peak_rms: f32,
}

pub struct SessionManager {
    pub engine_state: Mutex<EngineState>,
    pub daemon: Mutex<Option<AsrDaemon>>,
    recording: Mutex<Option<ActiveRecording>>,
    pub overlay_ui: Mutex<overlay::OverlayUiState>,
    /// 关闭/重置会话中：音频线程不得向 UI emit，避免与主线程 join 死锁
    closing: AtomicBool,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            engine_state: Mutex::new(EngineState::Idle),
            daemon: Mutex::new(None),
            recording: Mutex::new(None),
            overlay_ui: Mutex::new(overlay::OverlayUiState::default()),
            closing: AtomicBool::new(false),
        }
    }

    pub fn is_closing(&self) -> bool {
        self.closing.load(Ordering::Acquire)
    }

    fn set_closing(&self, closing: bool) {
        self.closing.store(closing, Ordering::Release);
    }

    pub fn sync_overlay_text(&self, app: &AppHandle, text: String) {
        if let Ok(mut rec) = self.recording.lock() {
            if let Some(r) = rec.as_mut() {
                r.segment_base = text.clone();
                r.last_partial = text.clone();
            }
        }
        let phase = self
            .overlay_ui
            .lock()
            .map(|g| g.phase.clone())
            .unwrap_or_else(|_| "editing".to_string());
        let session_id = self
            .overlay_ui
            .lock()
            .map(|g| g.session_id.clone())
            .unwrap_or_default();
        if let Ok(mut ui) = self.overlay_ui.lock() {
            ui.display_text = text.clone();
        }
        overlay::set_ui_state(
            app,
            overlay::OverlayUiState {
                phase,
                display_text: text,
                session_id,
            },
        );
    }

    pub fn set_overlay_ui(&self, app: &AppHandle, state: overlay::OverlayUiState) {
        if let Ok(mut guard) = self.overlay_ui.lock() {
            *guard = state.clone();
        }
        overlay::set_ui_state(app, state);
    }

    pub fn engine_status(&self) -> (String, Option<String>) {
        match self.engine_state.lock().map(|g| g.clone()) {
            Ok(EngineState::Ready) => ("ready".to_string(), None),
            Ok(EngineState::Loading) => ("loading".to_string(), None),
            Ok(EngineState::Error(msg)) => ("error".to_string(), Some(msg)),
            _ => ("idle".to_string(), None),
        }
    }
}

impl Clone for EngineState {
    fn clone(&self) -> Self {
        match self {
            EngineState::Idle => EngineState::Idle,
            EngineState::Loading => EngineState::Loading,
            EngineState::Ready => EngineState::Ready,
            EngineState::Error(s) => EngineState::Error(s.clone()),
        }
    }
}

fn merge_display(segment_base: &str, partial: &str) -> String {
    let partial = partial.trim();
    if partial.is_empty() {
        return segment_base.to_string();
    }
    if segment_base.is_empty() {
        return partial.to_string();
    }
    if partial.starts_with(segment_base) {
        return partial.to_string();
    }
    format!("{segment_base}{partial}")
}

fn stop_capture(rec: &mut ActiveRecording) {
    if let Some(c) = rec.capture.take() {
        let t0 = Instant::now();
        crate::debug_log::info("stop_capture: signaling audio thread");
        c.stop();
        crate::debug_log::info(format!(
            "stop_capture: audio thread joined ({}ms)",
            t0.elapsed().as_millis()
        ));
    } else {
        crate::debug_log::info("stop_capture: no capture handle");
    }
}

fn end_asr_session(daemon: &AsrDaemon, session_id: &str) {
    let t0 = Instant::now();
    crate::debug_log::info(format!("end_asr_session: send end cmd session={session_id}"));
    if let Err(e) = daemon.end(session_id) {
        crate::debug_log::warn(format!("end_asr_session: end cmd failed: {e}"));
    }
    drain_asr_events(daemon, session_id, Duration::from_millis(600));
    crate::debug_log::info(format!(
        "end_asr_session: drained events ({}ms)",
        t0.elapsed().as_millis()
    ));
}

fn drain_asr_events(daemon: &AsrDaemon, session_id: &str, timeout: Duration) {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        while let Some(ev) = daemon.try_recv_event() {
            if ev.session_id.as_deref() == Some(session_id) {
                let _ = ev;
            }
        }
        std::thread::sleep(Duration::from_millis(30));
    }
}

pub fn reset_overlay_session(app: &AppHandle, manager: &SessionManager) {
    if manager.is_closing() {
        crate::debug_log::warn("reset_overlay_session: already closing, skip");
        return;
    }
    manager.set_closing(true);
    let t0 = Instant::now();
    crate::debug_log::info("reset_overlay_session: begin");

    let session_id = manager
        .recording
        .lock()
        .unwrap()
        .as_ref()
        .map(|r| r.session_id.clone());
    crate::debug_log::info(format!(
        "reset_overlay_session: active session={:?}",
        session_id
    ));

    if let Some(mut rec) = manager.recording.lock().unwrap().take() {
        stop_capture(&mut rec);
    } else {
        crate::debug_log::info("reset_overlay_session: no recording to stop");
    }

    if let Some(sid) = session_id {
        if let Some(daemon) = manager.daemon.lock().unwrap().as_ref() {
            end_asr_session(daemon, &sid);
        } else {
            crate::debug_log::warn("reset_overlay_session: no ASR daemon");
        }
    }

    manager.set_overlay_ui(app, overlay::OverlayUiState::default());
    overlay::emit_session_reset(app);
    manager.set_closing(false);
    crate::debug_log::info(format!(
        "reset_overlay_session: complete ({}ms)",
        t0.elapsed().as_millis()
    ));
}

pub fn start_engine(app: AppHandle, manager: Arc<SessionManager>, settings: SrSettings) {
    std::thread::spawn(move || {
        crate::debug_log::info(format!(
            "engine start: model_dir={} enabled={} hotkey={} trigger={}",
            settings.model_dir,
            settings.enabled,
            settings.hotkey,
            settings.bubble_trigger_mode
        ));
        {
            let mut st = manager.engine_state.lock().unwrap();
            *st = EngineState::Loading;
        }
        overlay::emit_engine(&app, "loading", None);

        let daemon = match AsrDaemon::spawn(&app) {
            Ok(d) => d,
            Err(e) => {
                set_engine_error(&app, &manager, e);
                return;
            }
        };

        if settings.asr_engine != "sherpa-onnx" {
            set_engine_error(&app, &manager, "所选识别引擎尚未支持".to_string());
            return;
        }

        let Some(model_dir) = crate::settings::resolve_runtime_model_dir(&app, &settings) else {
            set_engine_error(
                &app,
                &manager,
                "内置语音模型未找到，请确认安装包完整".to_string(),
            );
            return;
        };
        crate::debug_log::info(format!("using model_dir={model_dir}"));
        if let Err(e) = daemon.load_model(&model_dir) {
            set_engine_error(&app, &manager, e);
            return;
        }

        {
            let mut guard = manager.daemon.lock().unwrap();
            *guard = Some(daemon);
            let mut st = manager.engine_state.lock().unwrap();
            *st = EngineState::Ready;
        }
        overlay::emit_engine(&app, "ready", None);
        crate::debug_log::info("engine ready");
    });
}

fn set_engine_error(app: &AppHandle, manager: &SessionManager, message: String) {
    crate::debug_log::error(format!("engine error: {message}"));
    {
        let mut st = manager.engine_state.lock().unwrap();
        *st = EngineState::Error(message.clone());
        let mut guard = manager.daemon.lock().unwrap();
        *guard = None;
    }
    overlay::emit_engine(app, "error", Some(&message));
}

pub fn restart_engine(app: AppHandle, manager: Arc<SessionManager>, settings: SrSettings) {
    reset_overlay_session(&app, &manager);
    overlay::hide(&app);
    {
        let mut guard = manager.daemon.lock().unwrap();
        *guard = None;
    }
    start_engine(app, manager, settings);
}

fn finalize_text_for_write(
    manager: &SessionManager,
    text_override: Option<String>,
) -> (TargetHwnd, String) {
    let mut rec = manager.recording.lock().unwrap().take();
    if let Some(mut r) = rec {
        let target = r.target;
        stop_capture(&mut r);

        let mut text = text_override.unwrap_or_else(|| {
            if !r.segment_base.is_empty() {
                r.segment_base.clone()
            } else {
                r.last_partial.clone()
            }
        });

        if let Some(daemon) = manager.daemon.lock().unwrap().as_ref() {
            let _ = daemon.end(&r.session_id);
            if let Ok(final_text) = daemon.wait_final(&r.session_id, Duration::from_millis(600)) {
                if !final_text.trim().is_empty() {
                    text = merge_display(&r.segment_base, &final_text);
                } else if !r.last_partial.is_empty() {
                    text = merge_display(&r.segment_base, &r.last_partial);
                }
            } else if !r.last_partial.is_empty() {
                text = merge_display(&r.segment_base, &r.last_partial);
            }
        }

        return (target, text.trim().to_string());
    }

    let text = text_override
        .or_else(|| {
            manager
                .overlay_ui
                .lock()
                .ok()
                .map(|g| g.display_text.clone())
        })
        .unwrap_or_default();
    (
        crate::focus::capture_foreground_target(),
        text.trim().to_string(),
    )
}

pub fn write_overlay_text(
    app: AppHandle,
    manager: Arc<SessionManager>,
    settings: SrSettings,
    text_override: Option<String>,
) -> Result<(), String> {
    std::thread::spawn(move || {
        let (target, trimmed) = finalize_text_for_write(&manager, text_override);
        if trimmed.is_empty() {
            return;
        }

        let session_id = manager
            .overlay_ui
            .lock()
            .map(|g| g.session_id.clone())
            .unwrap_or_default();

        if !target.is_valid() {
            crate::debug_log::info("write skipped: no target window");
            reset_overlay_session(&app, &manager);
            overlay::emit_write_result(&app, &session_id, false, Some("未找到可写入的窗口"));
            if crate::settings::is_click_trigger(&settings) {
                overlay::hide(&app);
            }
            return;
        }

        match text_inject::inject_text(&settings, target, &trimmed) {
            Ok(()) => {
                crate::debug_log::info(format!("write ok: {} chars", trimmed.len()));
                overlay::emit_text_written(&app, &session_id, &trimmed);
                reset_overlay_session(&app, &manager);
                if crate::settings::is_click_trigger(&settings) {
                    overlay::hide(&app);
                }
            }
            Err(e) => {
                crate::debug_log::warn(format!("write failed: {e}"));
                overlay::emit_write_result(&app, &session_id, false, Some(&e));
            }
        }
    });
    Ok(())
}

pub fn on_hotkey_pressed(
    app: AppHandle,
    manager: Arc<SessionManager>,
    settings: SrSettings,
) {
    crate::debug_log::info(format!(
        "hotkey pressed: enabled={} trigger={}",
        settings.enabled,
        settings.bubble_trigger_mode
    ));
    if crate::settings::is_click_trigger(&settings) {
        on_hotkey_click(app, manager, settings);
        return;
    }
    start_recording(app, manager, settings);
}

pub fn on_hotkey_click(app: AppHandle, manager: Arc<SessionManager>, settings: SrSettings) {
    if !settings.enabled {
        crate::debug_log::warn("hotkey ignored: disabled");
        return;
    }
    if manager.recording.lock().unwrap().is_some() {
        crate::debug_log::info("hotkey: reset stale session before new recording");
        reset_overlay_session(&app, &manager);
    }
    start_recording(app, manager, settings);
}

pub fn on_hotkey_released(app: AppHandle, _manager: Arc<SessionManager>, settings: SrSettings) {
    if crate::settings::is_click_trigger(&settings) {
        return;
    }
    crate::debug_log::info("hotkey released (hold mode)");
}

pub fn enter_manual_edit(
    app: &AppHandle,
    manager: &SessionManager,
    text_override: Option<String>,
) -> Result<(), String> {
    let (session_id, text) = {
        let mut guard = manager.recording.lock().map_err(|e| e.to_string())?;
        let Some(rec) = guard.as_mut() else {
            return Err("当前没有进行中的识别会话".to_string());
        };
        if rec.manual_editing {
            return Ok(());
        }
        let text = text_override.unwrap_or_else(|| {
            if !rec.last_partial.trim().is_empty() {
                rec.last_partial.clone()
            } else {
                rec.segment_base.clone()
            }
        });
        if text.trim().is_empty() {
            return Err("暂无文字可编辑".to_string());
        }
        rec.manual_editing = true;
        rec.segment_base = text.clone();
        rec.last_partial = text.clone();
        (rec.session_id.clone(), text)
    };

    crate::debug_log::info(format!("enter_manual_edit session={session_id}"));

    manager.set_overlay_ui(
        app,
        overlay::OverlayUiState {
            phase: "editing".to_string(),
            display_text: text.clone(),
            session_id: session_id.clone(),
        },
    );
    overlay::emit_manual_edit_enter(app, &session_id, &text);
    Ok(())
}

pub fn exit_manual_edit(
    app: &AppHandle,
    manager: &SessionManager,
    text_override: Option<String>,
) -> Result<(), String> {
    let (session_id, text) = {
        let mut guard = manager.recording.lock().map_err(|e| e.to_string())?;
        let Some(rec) = guard.as_mut() else {
            return Err("当前没有进行中的识别会话".to_string());
        };
        if !rec.manual_editing {
            return Ok(());
        }
        let text = text_override.unwrap_or_else(|| rec.segment_base.clone());
        rec.manual_editing = false;
        rec.segment_base = text.clone();
        rec.last_partial = text.clone();
        (rec.session_id.clone(), text)
    };

    crate::debug_log::info(format!("exit_manual_edit session={session_id}"));

    manager.set_overlay_ui(
        app,
        overlay::OverlayUiState {
            phase: "listening".to_string(),
            display_text: text.clone(),
            session_id: session_id.clone(),
        },
    );
    overlay::emit_manual_edit_exit(app, &session_id, &text);
    Ok(())
}

pub fn on_confirm_hotkey(
    app: AppHandle,
    manager: Arc<SessionManager>,
    settings: SrSettings,
) {
    if !settings.enabled {
        return;
    }
    let in_manual = manager
        .recording
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|r| r.manual_editing))
        .unwrap_or(false);
    if in_manual {
        let _ = exit_manual_edit(&app, &manager, None);
        return;
    }
    let _ = write_overlay_text(app, manager, settings, None);
}

fn handle_audio_level(app: &AppHandle, manager: Arc<SessionManager>, _session_id: &str, rms: f32) {
    if manager.is_closing() {
        return;
    }
    let manual = manager
        .recording
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|r| r.manual_editing))
        .unwrap_or(false);
    if !manual {
        overlay::emit_level(app, rms);
    }
}

fn start_capture_for_session(
    app: &AppHandle,
    manager: Arc<SessionManager>,
    settings: &SrSettings,
    session_id: &str,
) -> Result<(), String> {
    let on_chunk = build_on_chunk(app.clone(), manager.clone(), session_id.to_string());
    let on_level = {
        let app = app.clone();
        let manager = manager.clone();
        let session_id = session_id.to_string();
        Arc::new(move |rms: f32| {
            handle_audio_level(&app, manager.clone(), &session_id, rms);
        })
    };

    let capture = AudioCapture::start(
        settings.audio_device_name.as_deref(),
        on_chunk,
        on_level,
    )?;

    if let Some(rec) = manager.recording.lock().unwrap().as_mut() {
        rec.capture = Some(capture);
    }
    Ok(())
}

fn build_on_chunk(
    app: AppHandle,
    manager: Arc<SessionManager>,
    session_id: String,
) -> Arc<dyn Fn(Vec<f32>) + Send + Sync> {
    Arc::new(move |chunk: Vec<f32>| {
        if manager.is_closing() {
            return;
        }

        let rms =
            (chunk.iter().map(|s| s * s).sum::<f32>() / chunk.len().max(1) as f32).sqrt();

        let skip_asr = manager
            .recording
            .lock()
            .ok()
            .and_then(|g| g.as_ref().map(|r| r.manual_editing))
            .unwrap_or(true);

        if let Ok(mut rec) = manager.recording.lock() {
            if let Some(r) = rec.as_mut() {
                if r.session_id != session_id {
                    return;
                }
                r.chunk_count += 1;
                let n = r.chunk_count;
                if rms > r.peak_rms {
                    r.peak_rms = rms;
                }
                if n == 1 || n % 10 == 0 {
                    crate::debug_log::info(format!(
                        "audio chunk #{n} session={session_id} samples={} rms={rms:.4}",
                        chunk.len()
                    ));
                }
            }
        }

        if skip_asr {
            return;
        }

        let still_active = manager
            .recording
            .lock()
            .ok()
            .and_then(|g| {
                g.as_ref().map(|r| r.session_id == session_id && !r.manual_editing)
            })
            .unwrap_or(false);
        if !still_active {
            return;
        }

        let mut partial_updates: Vec<String> = Vec::new();
        {
            let daemon = manager.daemon.lock().unwrap();
            let Some(d) = daemon.as_ref() else {
                return;
            };
            if let Err(e) = d.push_audio(&session_id, &chunk) {
                crate::debug_log::error(format!("push_audio failed: {e}"));
                return;
            }
            while let Some(ev) = d.try_recv_event() {
                if ev.session_id.as_deref() != Some(session_id.as_str()) {
                    continue;
                }
                match ev.event.as_str() {
                    "partial" => {
                        if let Some(text) = ev.text.filter(|t| !t.trim().is_empty()) {
                            let display = {
                                let base = manager
                                    .recording
                                    .lock()
                                    .ok()
                                    .and_then(|g| g.as_ref().map(|r| r.segment_base.clone()))
                                    .unwrap_or_default();
                                merge_display(&base, &text)
                            };
                            if let Ok(mut rec) = manager.recording.lock() {
                                if let Some(r) = rec.as_mut() {
                                    if r.manual_editing {
                                        continue;
                                    }
                                    r.last_partial = display.clone();
                                    r.has_received_text = true;
                                }
                            }
                            partial_updates.push(display);
                        }
                    }
                    "error" => {
                        let msg = ev
                            .message
                            .or(ev.code)
                            .unwrap_or_else(|| "识别引擎错误".to_string());
                        crate::debug_log::error(format!("ASR error [{session_id}]: {msg}"));
                    }
                    _ => {}
                }
            }
        }

        if manager.is_closing() {
            return;
        }

        for display in partial_updates {
            overlay::emit_partial(&app, &session_id, &display);
            manager.set_overlay_ui(
                &app,
                overlay::OverlayUiState {
                    phase: "listening".to_string(),
                    display_text: display.clone(),
                    session_id: session_id.clone(),
                },
            );
        }
    })
}

fn start_recording(app: AppHandle, manager: Arc<SessionManager>, settings: SrSettings) {
    if !settings.enabled {
        return;
    }
    if manager.is_closing() {
        crate::debug_log::warn("start_recording skipped: session is closing");
        return;
    }
    if manager.recording.lock().unwrap().is_some() {
        return;
    }
    let engine_state = manager.engine_state.lock().unwrap().clone();
    if !matches!(engine_state, EngineState::Ready) {
        crate::debug_log::warn(format!(
            "start_recording skipped: engine not ready ({engine_state:?})"
        ));
        return;
    }

    let daemon_guard = manager.daemon.lock().unwrap();
    let Some(daemon) = daemon_guard.as_ref() else {
        crate::debug_log::error("start_recording failed: no daemon");
        return;
    };

    let session_id = Uuid::new_v4().to_string();
    let target = crate::focus::capture_foreground_target();
    crate::debug_log::info(format!(
        "start_recording session={} mic={}",
        session_id,
        settings
            .audio_device_name
            .as_deref()
            .filter(|n| !n.is_empty())
            .unwrap_or("auto")
    ));

    if let Err(e) = daemon.begin(&session_id) {
        crate::debug_log::error(format!("daemon.begin failed: {e}"));
        overlay::emit_session_end(&app, &session_id, false, None, Some(&e));
        return;
    }
    drop(daemon_guard);

    *manager.recording.lock().unwrap() = Some(ActiveRecording {
        session_id: session_id.clone(),
        target,
        capture: None,
        segment_base: String::new(),
        last_partial: String::new(),
        has_received_text: false,
        manual_editing: false,
        chunk_count: 0,
        peak_rms: 0.0,
    });

    if let Err(e) = start_capture_for_session(&app, manager.clone(), &settings, &session_id) {
        crate::debug_log::error(format!("AudioCapture.start failed: {e}"));
        if let Some(mut rec) = manager.recording.lock().unwrap().take() {
            stop_capture(&mut rec);
            if let Some(daemon) = manager.daemon.lock().unwrap().as_ref() {
                end_asr_session(daemon, &rec.session_id);
            }
        }
        overlay::emit_session_end(&app, &session_id, false, None, Some(&e));
        return;
    }

    if let Err(e) = overlay::show(&app, &settings) {
        overlay::emit_session_end(&app, &session_id, false, None, Some(&e));
        reset_overlay_session(&app, &manager);
        return;
    }

    manager.set_overlay_ui(
        &app,
        overlay::OverlayUiState {
            phase: "listening".to_string(),
            display_text: String::new(),
            session_id: session_id.clone(),
        },
    );
    overlay::emit_session_start(&app, &session_id);
    crate::debug_log::info(format!("recording active session={session_id}"));
}
