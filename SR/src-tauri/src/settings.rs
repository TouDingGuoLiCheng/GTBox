use crate::app_data;
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SrSettings {
    pub enabled: bool,
    pub hotkey: String,
    /// 确认写入快捷键（待确认状态下生效）
    #[serde(default = "default_confirm_hotkey")]
    pub confirm_hotkey: String,
    /// 气泡触发：click 单击后常驻桌面；hold 长按说话（松开结束）
    #[serde(default = "default_bubble_trigger_mode")]
    pub bubble_trigger_mode: String,
    /// 识别引擎：sherpa-onnx（内置模型，用户不可选路径）
    #[serde(default = "default_asr_engine")]
    pub asr_engine: String,
    #[serde(default)]
    pub model_dir: String,
    pub audio_device_name: Option<String>,
    pub output_mode: String,
    pub restore_clipboard: bool,
    /// 外观：dark | light
    #[serde(default = "default_app_theme")]
    pub app_theme: String,
    /// 悬浮条玻璃层不透明度 50–100
    #[serde(default = "default_overlay_opacity")]
    pub overlay_opacity: u8,
    /// 悬浮条背景图文件名（位于 AppData/backgrounds/）
    #[serde(default)]
    pub overlay_background: String,
    #[serde(default)]
    pub overlay_bg_layout: OverlayBgLayout,
    #[serde(default)]
    pub overlay_text_color: String,
    /// 音波条颜色（空则跟随主题渐变）
    #[serde(default)]
    pub overlay_wave_color: String,
    #[serde(default = "default_overlay_placement")]
    pub overlay_placement: String,
    #[serde(default = "default_overlay_edge_margin")]
    pub overlay_edge_margin: u32,
    #[serde(default = "default_overlay_tray_gap")]
    pub overlay_tray_gap: u32,
    /// 登录 Windows 时自动启动
    #[serde(default)]
    pub launch_at_startup: bool,
    /// 每次启动应用时清空诊断日志
    #[serde(default = "default_clear_log_on_startup")]
    pub clear_log_on_startup: bool,
}

fn default_overlay_placement() -> String {
    "bottom-center".to_string()
}

fn default_overlay_edge_margin() -> u32 {
    12
}

fn default_overlay_tray_gap() -> u32 {
    72
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct OverlayBgLayout {
    pub pos_x: u8,
    pub pos_y: u8,
    pub zoom: u8,
}

impl Default for OverlayBgLayout {
    fn default() -> Self {
        Self {
            pos_x: 50,
            pos_y: 50,
            zoom: 100,
        }
    }
}

fn default_overlay_opacity() -> u8 {
    88
}

fn default_bubble_trigger_mode() -> String {
    "click".to_string()
}

fn default_confirm_hotkey() -> String {
    "Alt+Enter".to_string()
}

fn default_app_theme() -> String {
    "light".to_string()
}

fn default_clear_log_on_startup() -> bool {
    true
}

fn default_asr_engine() -> String {
    "sherpa-onnx".to_string()
}

impl Default for SrSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            hotkey: "Alt+V".to_string(),
            confirm_hotkey: default_confirm_hotkey(),
            bubble_trigger_mode: default_bubble_trigger_mode(),
            asr_engine: default_asr_engine(),
            model_dir: String::new(),
            audio_device_name: None,
            output_mode: "paste".to_string(),
            restore_clipboard: true,
            app_theme: default_app_theme(),
            overlay_opacity: default_overlay_opacity(),
            overlay_background: String::new(),
            overlay_bg_layout: OverlayBgLayout::default(),
            overlay_text_color: String::new(),
            overlay_wave_color: String::new(),
            overlay_placement: default_overlay_placement(),
            overlay_edge_margin: default_overlay_edge_margin(),
            overlay_tray_gap: default_overlay_tray_gap(),
            launch_at_startup: false,
            clear_log_on_startup: default_clear_log_on_startup(),
        }
    }
}

pub fn load() -> SrSettings {
    let path = app_data::settings_path();
    let raw = if !path.is_file() {
        SrSettings::default()
    } else {
        let text = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&text).unwrap_or_default()
    };
    let had_model = is_valid_model_dir(&raw.model_dir);
    let prepared = prepare(raw);
    if !had_model && is_valid_model_dir(&prepared.model_dir) {
        let _ = save(&prepared);
    }
    prepared
}

/// 规范化并尝试自动发现本地模型目录
pub fn prepare(s: SrSettings) -> SrSettings {
    normalize(apply_model_dir_hint(s))
}

pub fn save(settings: &SrSettings) -> Result<(), String> {
    let settings = normalize(settings.clone());
    let dir = app_data::app_data_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {e}"))?;
    let json =
        serde_json::to_string_pretty(&settings).map_err(|e| format!("序列化配置失败: {e}"))?;
    fs::write(app_data::settings_path(), json).map_err(|e| format!("写入配置失败: {e}"))
}

pub fn normalize(mut s: SrSettings) -> SrSettings {
    s.hotkey = s.hotkey.trim().to_string();
    if s.hotkey.is_empty() {
        s.hotkey = "Alt+V".to_string();
    }
    s.confirm_hotkey = s.confirm_hotkey.trim().to_string();
    if s.confirm_hotkey.is_empty() {
        s.confirm_hotkey = default_confirm_hotkey();
    }
    s.model_dir = s.model_dir.trim().to_string();
    if !matches!(
        s.output_mode.as_str(),
        "paste" | "type" | "clipboard"
    ) {
        s.output_mode = "paste".to_string();
    }
    if s.app_theme != "dark" {
        s.app_theme = "light".to_string();
    }
    s.overlay_opacity = s.overlay_opacity.clamp(50, 100);
    s.overlay_bg_layout.pos_x = s.overlay_bg_layout.pos_x.min(100);
    s.overlay_bg_layout.pos_y = s.overlay_bg_layout.pos_y.min(100);
    s.overlay_bg_layout.zoom = s.overlay_bg_layout.zoom.clamp(50, 250);
    const PLACEMENTS: &[&str] = &[
        "bottom-center",
        "bottom-right",
        "bottom-left",
        "top-center",
        "top-right",
        "top-left",
        "center",
    ];
    if !PLACEMENTS.contains(&s.overlay_placement.as_str()) {
        s.overlay_placement = default_overlay_placement();
    }
    s.overlay_edge_margin = s.overlay_edge_margin.clamp(0, 120);
    s.overlay_tray_gap = s.overlay_tray_gap.clamp(40, 160);
    s.overlay_wave_color = s.overlay_wave_color.trim().to_string();
    if s.bubble_trigger_mode != "hold" {
        s.bubble_trigger_mode = default_bubble_trigger_mode();
    }
    if s.asr_engine != "sherpa-onnx" {
        s.asr_engine = default_asr_engine();
    }
    normalize_audio_device(&mut s);
    s
}

/// `None` = 自动跟随系统默认麦克风；与系统默认同名的已存配置也归一为自动
fn normalize_audio_device(s: &mut SrSettings) {
    match s.audio_device_name.as_ref() {
        None => {}
        Some(name) if name.trim().is_empty() => s.audio_device_name = None,
        Some(name) => {
            if crate::audio::default_input_device_name().as_deref() == Some(name.as_str()) {
                s.audio_device_name = None;
            }
        }
    }
}

pub fn is_click_trigger(settings: &SrSettings) -> bool {
    settings.bubble_trigger_mode == "click"
}

pub fn is_valid_model_dir(path: &str) -> bool {
    let p = std::path::Path::new(path.trim());
    p.is_dir() && p.join("tokens.txt").is_file()
}

/// 在 workspaces/sr_asr/models 下查找含 tokens.txt 的模型目录
pub fn discover_model_dir() -> Option<String> {
    let models = app_data::workspaces_sr_asr().join("models");
    if !models.is_dir() {
        return None;
    }
    if let Ok(entries) = fs::read_dir(&models) {
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_dir() {
                continue;
            }
            let s = p.to_string_lossy().to_string();
            if is_valid_model_dir(&s) {
                return Some(s);
            }
        }
    }
    None
}

/// 安装包内模型目录（与可执行文件同级的 models/ 子目录）
pub fn bundled_model_dir() -> Option<String> {
    let mut roots: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            roots.push(dir.join("models"));
            roots.push(dir.join("resources").join("models"));
        }
    }
    if let Ok(manifest) = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).canonicalize() {
        roots.push(manifest.join("resources").join("models"));
    }
    for root in roots {
        if let Some(found) = find_model_under(&root) {
            return Some(found);
        }
    }
    None
}

pub fn find_model_under(root: &std::path::Path) -> Option<String> {
    if !root.is_dir() {
        return None;
    }
    let direct = root.to_string_lossy().to_string();
    if is_valid_model_dir(&direct) {
        return Some(direct);
    }
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_dir() {
                continue;
            }
            let s = p.to_string_lossy().to_string();
            if is_valid_model_dir(&s) {
                return Some(s);
            }
        }
    }
    None
}

/// 解析模型目录：打包资源 → 开发目录 workspaces/sr_asr/models
pub fn resolve_model_dir() -> Option<String> {
    bundled_model_dir().or_else(discover_model_dir)
}

/// 运行时解析（安装包内 Tauri Resource 目录优先）
pub fn resolve_runtime_model_dir(
    app: &tauri::AppHandle,
    settings: &SrSettings,
) -> Option<String> {
    let trimmed = settings.model_dir.trim();
    if is_valid_model_dir(trimmed) {
        return Some(trimmed.to_string());
    }
    if let Ok(p) = app.path().resolve("models", tauri::path::BaseDirectory::Resource) {
        crate::debug_log::info(format!("lookup model in resource: {}", p.display()));
        if let Some(m) = find_model_under(&p) {
            return Some(m);
        }
    }
    bundled_model_dir().or_else(discover_model_dir)
}

fn apply_model_dir_hint(mut s: SrSettings) -> SrSettings {
    if let Some(dir) = resolve_model_dir() {
        s.model_dir = dir;
    }
    s
}
