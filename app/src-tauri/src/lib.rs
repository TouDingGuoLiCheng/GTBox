use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::io::Cursor;
use std::process::{Command, Stdio};
use std::sync::{Arc, LazyLock, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};
use rfd::FileDialog;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    workspace_root: String,
    python_path: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            workspace_root: default_workspace_root(),
            python_path: String::from(r".venv\Scripts\python.exe"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginParam {
    name: String,
    label: String,
    #[serde(rename = "type")]
    param_type: String,
    default: Option<Value>,
    flag: Option<String>,
    options: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScriptConfig {
    entry: String,
    interpreter: Option<String>,
    cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginManifest {
    id: String,
    name: String,
    description: String,
    category: String,
    icon: Option<String>,
    tags: Option<Vec<String>>,
    custom_route: Option<String>,
    /// 不在主页工具列表展示（仍可由整合页或其它入口调用）
    #[serde(default)]
    hidden_from_home: bool,
    script: ScriptConfig,
    params: Option<Vec<PluginParam>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolLogEvent {
    run_id: String,
    stream: String,
    line: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolExitEvent {
    run_id: String,
    code: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaFile {
    name: String,
    path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegionBoxInput {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OcrRegion {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    text: String,
    score: f64,
    #[serde(default)]
    role: Option<String>,
    #[serde(default)]
    pair_index: Option<u32>,
    #[serde(default)]
    note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegionRecognizeResult {
    index: usize,
    text: String,
    score: f64,
}

#[derive(Default)]
struct AppState {
    running_pids: Arc<Mutex<HashMap<String, u32>>>,
}

fn settings_path() -> Result<PathBuf, String> {
    let appdata = env::var("APPDATA").map_err(|_| String::from("未找到 APPDATA 环境变量"))?;
    Ok(Path::new(&appdata)
        .join("guolicheng-toolbox")
        .join("settings.json"))
}

/// 工具箱仓库根目录：`.../工具箱开发`（`app/src-tauri` 的上两级）
fn toolbox_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("CARGO_MANIFEST_DIR 应位于 app/src-tauri 下")
        .to_path_buf()
}

fn default_workspace_root() -> String {
    toolbox_root()
        .join("workspaces")
        .join("music_crawl")
        .to_string_lossy()
        .into_owned()
}

fn plugins_root() -> PathBuf {
    toolbox_root().join("plugins")
}

fn workspaces_root() -> PathBuf {
    toolbox_root().join("workspaces")
}

/// 插件脚本路径：优先相对仓库 `workspaces/`（如 auto_change_file_name/），否则相对用户工作区（如 music_crawl/）
fn resolve_script_path(workspace_root: &str, entry: &str) -> PathBuf {
    let entry_path = Path::new(entry);
    if entry_path.is_absolute() {
        return entry_path.to_path_buf();
    }
    let from_repo = workspaces_root().join(entry);
    if from_repo.exists() {
        return from_repo;
    }
    resolve_path(workspace_root, entry)
}

fn resolve_script_cwd(workspace_root: &str, cwd: Option<&str>) -> PathBuf {
    if let Some(c) = cwd {
        let from_repo = workspaces_root().join(c);
        if from_repo.exists() {
            return from_repo;
        }
        let from_user = resolve_path(workspace_root, c);
        if from_user.exists() {
            return from_user;
        }
        return from_user;
    }
    PathBuf::from(workspace_root)
}

fn region_ocr_script_path() -> PathBuf {
    plugins_root().join("playlist_ocr").join("region_ocr.py")
}

fn resolve_python_interpreter(
    settings: &AppSettings,
    interpreter_hint: Option<&str>,
    script_cwd: Option<&Path>,
) -> PathBuf {
    match interpreter_hint.unwrap_or("python") {
        "venv" => {
            if let Some(cwd) = script_cwd {
                let local = cwd.join(".venv\\Scripts\\python.exe");
                if local.exists() {
                    return local;
                }
            }
            let candidate = Path::new(&settings.workspace_root).join(".venv\\Scripts\\python.exe");
            if candidate.exists() {
                candidate
            } else {
                PathBuf::from("python")
            }
        }
        "python" => {
            let configured = resolve_path(&settings.workspace_root, &settings.python_path);
            if configured.exists() {
                configured
            } else {
                PathBuf::from("python")
            }
        }
        raw => resolve_path(&settings.workspace_root, raw),
    }
}

fn push_unique_python_candidate(candidates: &mut Vec<PathBuf>, seen: &mut std::collections::HashSet<String>, path: PathBuf) {
    let key = path.to_string_lossy().to_ascii_lowercase();
    if seen.insert(key) {
        candidates.push(path);
    }
}

fn collect_python_candidates(settings: &AppSettings, interpreter_hint: Option<&str>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let mut seen = std::collections::HashSet::new();

    match interpreter_hint.unwrap_or("python") {
        "venv" => push_unique_python_candidate(
            &mut candidates,
            &mut seen,
            Path::new(&settings.workspace_root).join(".venv\\Scripts\\python.exe"),
        ),
        "python" => push_unique_python_candidate(
            &mut candidates,
            &mut seen,
            resolve_path(&settings.workspace_root, &settings.python_path),
        ),
        raw => push_unique_python_candidate(
            &mut candidates,
            &mut seen,
            resolve_path(&settings.workspace_root, raw),
        ),
    }

    push_unique_python_candidate(
        &mut candidates,
        &mut seen,
        resolve_path(&settings.workspace_root, &settings.python_path),
    );
    push_unique_python_candidate(&mut candidates, &mut seen, PathBuf::from("python"));
    candidates
}

fn python_has_ocr_deps(interpreter: &Path) -> bool {
    if interpreter != Path::new("python") && !interpreter.exists() {
        return false;
    }
    Command::new(interpreter)
        .args(["-c", "import cv2; import paddleocr"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn apply_python_utf8_env(cmd: &mut Command) {
    cmd.env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1");
}

fn format_subprocess_error(stderr: &[u8], stdout: &[u8]) -> String {
    let stderr = String::from_utf8_lossy(stderr);
    if let Some(idx) = stderr.rfind("Traceback (most recent call last)") {
        return stderr[idx..].trim().to_string();
    }
    if !stderr.trim().is_empty() {
        return stderr.trim().to_string();
    }
    String::from_utf8_lossy(stdout).trim().to_string()
}

fn resolve_python_for_ocr(settings: &AppSettings, interpreter_hint: Option<&str>) -> Result<PathBuf, String> {
    let candidates = collect_python_candidates(settings, interpreter_hint);
    for candidate in &candidates {
        if python_has_ocr_deps(candidate) {
            return Ok(candidate.clone());
        }
    }

    let tried = candidates
        .iter()
        .map(|p| p.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "未找到可用的 Python OCR 环境（需要 cv2、paddleocr）。已尝试: {}。\
         请在工作区执行: .venv\\Scripts\\python.exe -m pip install -r playlist_ocr/requirements-ocr.txt \
         或在设置页将 python_path 指向已安装依赖的解释器。",
        tried
    ))
}

fn should_resolve_param_path(param: &PluginParam) -> bool {
    if param.param_type == "folder" {
        return true;
    }
    matches!(
        param.name.as_str(),
        "input" | "output" | "review" | "downloadDir" | "counterFile" | "inputsFile"
    )
}

fn resolve_path(workspace_root: &str, raw: &str) -> PathBuf {
    let path = PathBuf::from(raw);
    if path.is_absolute() {
        path
    } else {
        Path::new(workspace_root).join(path)
    }
}

fn to_cli_value(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::Bool(v) => Some(v.to_string()),
        Value::Number(v) => Some(v.to_string()),
        Value::String(v) => {
            if v.trim().is_empty() {
                None
            } else {
                Some(v.clone())
            }
        }
        _ => Some(value.to_string()),
    }
}

fn to_kebab(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars() {
        if c.is_uppercase() {
            if !out.is_empty() {
                out.push('-');
            }
            out.push(c.to_ascii_lowercase());
        } else {
            out.push(c);
        }
    }
    out
}

fn read_manifest_file(path: &Path) -> Result<PluginManifest, String> {
    let text = fs::read_to_string(path)
        .map_err(|e| format!("读取 manifest 失败: {} ({})", path.display(), e))?;
    serde_json::from_str::<PluginManifest>(&text)
        .map_err(|e| format!("解析 manifest 失败: {} ({})", path.display(), e))
}

fn load_plugin_manifest(plugin_id: &str) -> Result<PluginManifest, String> {
    let manifest_path = plugins_root().join(plugin_id).join("manifest.json");
    if !manifest_path.exists() {
        return Err(format!("未找到插件 manifest: {}", manifest_path.display()));
    }
    read_manifest_file(&manifest_path)
}

fn spawn_log_reader<R: std::io::Read + Send + 'static>(
    app: AppHandle,
    run_id: String,
    stream: &str,
    reader: R,
) {
    let stream_name = String::from(stream);
    thread::spawn(move || {
        let buffered = BufReader::new(reader);
        for line in buffered.lines().map_while(Result::ok) {
            let _ = app.emit(
                "tool:log",
                ToolLogEvent {
                    run_id: run_id.clone(),
                    stream: stream_name.clone(),
                    line,
                },
            );
        }
    });
}

fn build_python_command(
    settings: &AppSettings,
    plugin: &PluginManifest,
    input_params: Option<Map<String, Value>>,
) -> Result<Command, String> {
    let interpreter_kind = plugin
        .script
        .interpreter
        .clone()
        .unwrap_or_else(|| String::from("python"));
    let cwd = resolve_script_cwd(&settings.workspace_root, plugin.script.cwd.as_deref());
    if !cwd.exists() {
        return Err(format!("工作目录不存在: {}", cwd.display()));
    }

    let interpreter = if plugin.id == "playlist_ocr" {
        resolve_python_for_ocr(settings, Some(interpreter_kind.as_str()))?
    } else {
        resolve_python_interpreter(
            settings,
            Some(interpreter_kind.as_str()),
            Some(cwd.as_path()),
        )
    };

    let script_path = resolve_script_path(&settings.workspace_root, &plugin.script.entry);
    if !script_path.exists() {
        let repo_try = workspaces_root().join(&plugin.script.entry);
        return Err(format!(
            "脚本不存在: {}\n已尝试仓库路径: {}",
            script_path.display(),
            repo_try.display()
        ));
    }

    let mut cmd = Command::new(interpreter);
    apply_python_utf8_env(&mut cmd);
    cmd.arg(script_path)
        .current_dir(cwd)
        .env("PYTHONUNBUFFERED", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let values = input_params.unwrap_or_default();
    if let Some(params) = &plugin.params {
        for param in params {
            let value = values
                .get(&param.name)
                .cloned()
                .or_else(|| param.default.clone());
            let Some(value) = value else {
                continue;
            };

            if param.param_type == "boolean" {
                if value.as_bool().unwrap_or(false) {
                    cmd.arg(
                        param
                            .flag
                            .clone()
                            .unwrap_or_else(|| format!("--{}", to_kebab(&param.name))),
                    );
                }
                continue;
            }

            let Some(v) = to_cli_value(&value) else {
                continue;
            };
            let v = if should_resolve_param_path(param) {
                resolve_path(&settings.workspace_root, &v)
                    .to_string_lossy()
                    .to_string()
            } else {
                v
            };
            let flag = param
                .flag
                .clone()
                .unwrap_or_else(|| format!("--{}", to_kebab(&param.name)));
            cmd.arg(flag).arg(v);
        }
    } else {
        for (key, value) in values {
            if let Some(v) = to_cli_value(&value) {
                cmd.arg(format!("--{}", to_kebab(&key))).arg(v);
            }
        }
    }

    Ok(cmd)
}

#[tauri::command]
fn get_settings() -> Result<AppSettings, String> {
    let path = settings_path()?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let text = fs::read_to_string(&path)
        .map_err(|e| format!("读取设置失败: {} ({})", path.display(), e))?;
    serde_json::from_str::<AppSettings>(&text).map_err(|e| format!("解析设置失败: {}", e))
}

#[tauri::command]
fn save_settings(settings: AppSettings) -> Result<(), String> {
    let path = settings_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建设置目录失败: {} ({})", parent.display(), e))?;
    }

    let text =
        serde_json::to_string_pretty(&settings).map_err(|e| format!("序列化设置失败: {}", e))?;
    fs::write(&path, text).map_err(|e| format!("写入设置失败: {} ({})", path.display(), e))
}

#[tauri::command]
fn list_plugins() -> Result<Vec<PluginManifest>, String> {
    let root = plugins_root();
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut plugins = Vec::new();
    let entries = fs::read_dir(&root)
        .map_err(|e| format!("读取插件目录失败: {} ({})", root.display(), e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取插件目录项失败: {}", e))?;
        let manifest_path = entry.path().join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }
        let plugin = read_manifest_file(&manifest_path)?;
        if !plugin.hidden_from_home {
            plugins.push(plugin);
        }
    }

    plugins.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(plugins)
}

#[tauri::command]
fn run_tool(
    app: AppHandle,
    state: State<AppState>,
    plugin_id: String,
    params: Option<Map<String, Value>>,
) -> Result<String, String> {
    let settings = get_settings()?;
    let plugin = load_plugin_manifest(&plugin_id)?;
    let mut command = build_python_command(&settings, &plugin, params)?;
    let mut child = command
        .spawn()
        .map_err(|e| format!("启动脚本失败: {} ({})", plugin_id, e))?;

    let pid = child.id();
    let run_id = format!(
        "{}-{}",
        plugin_id,
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| format!("生成 run_id 失败: {}", e))?
            .as_millis()
    );

    if let Ok(mut map) = state.running_pids.lock() {
        map.insert(run_id.clone(), pid);
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    if let Some(out) = stdout {
        spawn_log_reader(app.clone(), run_id.clone(), "stdout", out);
    }
    if let Some(err) = stderr {
        spawn_log_reader(app.clone(), run_id.clone(), "stderr", err);
    }

    let running = state.running_pids.clone();
    let run_id_for_exit = run_id.clone();
    thread::spawn(move || {
        let code = child
            .wait()
            .ok()
            .and_then(|status| status.code())
            .unwrap_or(-1);
        if let Ok(mut map) = running.lock() {
            map.remove(&run_id_for_exit);
        }
        let _ = app.emit(
            "tool:exit",
            ToolExitEvent {
                run_id: run_id_for_exit,
                code,
            },
        );
    });

    Ok(run_id)
}

#[tauri::command]
fn cancel_run(state: State<AppState>, run_id: String) -> Result<bool, String> {
    let pid = {
        let map = state
            .running_pids
            .lock()
            .map_err(|_| String::from("运行状态锁异常"))?;
        map.get(&run_id).cloned()
    };

    let Some(pid) = pid else {
        return Ok(false);
    };

    let status = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .status()
        .map_err(|e| format!("终止进程失败: {}", e))?;
    Ok(status.success())
}

#[tauri::command]
fn read_workspace_file(relative_path: String) -> Result<String, String> {
    let settings = get_settings()?;
    let path = resolve_path(&settings.workspace_root, &relative_path);
    fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {} ({})", path.display(), e))
}

#[tauri::command]
fn write_workspace_file(relative_path: String, content: String) -> Result<(), String> {
    let settings = get_settings()?;
    let path = resolve_path(&settings.workspace_root, &relative_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败: {} ({})", parent.display(), e))?;
    }
    fs::write(&path, content).map_err(|e| format!("写入文件失败: {} ({})", path.display(), e))
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let file = PathBuf::from(&path);
    if !file.exists() {
        return Err(format!("文件不存在: {}", file.display()));
    }
    fs::read_to_string(&file).map_err(|e| format!("读取文件失败: {} ({})", file.display(), e))
}

#[tauri::command]
fn read_image_as_data_url(path: String) -> Result<String, String> {
    let settings = get_settings()?;
    let image_path = resolve_path(&settings.workspace_root, &path);
    if !image_path.exists() {
        return Err(format!("图片不存在: {}", image_path.display()));
    }
    let bytes =
        fs::read(&image_path).map_err(|e| format!("读取图片失败: {} ({})", image_path.display(), e))?;
    let ext = image_path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "gif" => "image/gif",
        _ => "application/octet-stream",
    };
    Ok(format!("data:{};base64,{}", mime, STANDARD.encode(bytes)))
}

/// 将用户选择的媒体文件复制到 toolbox/workspaces 下（用于创意背景字符画等）
#[tauri::command]
fn copy_file_to_workspaces(source_abs: String, subpath: String) -> Result<String, String> {
    let src = PathBuf::from(&source_abs);
    if !src.is_file() {
        return Err(format!("源文件不存在: {}", src.display()));
    }
    let dest = workspaces_root().join(&subpath);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败: {} ({})", parent.display(), e))?;
    }
    fs::copy(&src, &dest).map_err(|e| {
        format!(
            "复制文件失败: {} -> {} ({})",
            src.display(),
            dest.display(),
            e
        )
    })?;
    Ok(subpath)
}

#[derive(Clone)]
struct PreviewCacheEntry {
    mtime_ms: u64,
    max_w: u32,
    max_h: u32,
    quality: u8,
    data_url: String,
}

static PREVIEW_CACHE: LazyLock<Mutex<HashMap<String, PreviewCacheEntry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

const PREVIEW_CACHE_MAX: usize = 80;

fn file_mtime_ms(path: &Path) -> Result<u64, String> {
    let meta = fs::metadata(path).map_err(|e| format!("读取文件信息失败: {} ({})", path.display(), e))?;
    let modified = meta
        .modified()
        .map_err(|e| format!("读取修改时间失败: {} ({})", path.display(), e))?;
    modified
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .map_err(|e| format!("时间戳无效: {}", e))
}

fn read_image_preview_sync(
    path: String,
    max_width: u32,
    max_height: u32,
    quality: u8,
) -> Result<String, String> {
    let settings = get_settings()?;
    let image_path = resolve_path(&settings.workspace_root, &path);
    if !image_path.exists() {
        return Err(format!("图片不存在: {}", image_path.display()));
    }

    let cache_key = image_path.to_string_lossy().into_owned();
    let mtime_ms = file_mtime_ms(&image_path)?;

    if let Ok(cache) = PREVIEW_CACHE.lock() {
        if let Some(entry) = cache.get(&cache_key) {
            if entry.mtime_ms == mtime_ms
                && entry.max_w == max_width
                && entry.max_h == max_height
                && entry.quality == quality
            {
                return Ok(entry.data_url.clone());
            }
        }
    }

    let img = image::open(&image_path)
        .map_err(|e| format!("解码图片失败: {} ({})", image_path.display(), e))?;
    let thumb = img.thumbnail(max_width, max_height);
    let mut buf = Vec::new();
    let mut cursor = Cursor::new(&mut buf);
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, quality);
    thumb
        .write_with_encoder(encoder)
        .map_err(|e| format!("生成预览失败: {}", e))?;
    let data_url = format!("data:image/jpeg;base64,{}", STANDARD.encode(buf));

    if let Ok(mut cache) = PREVIEW_CACHE.lock() {
        if cache.len() >= PREVIEW_CACHE_MAX {
            if let Some(oldest) = cache.keys().next().cloned() {
                cache.remove(&oldest);
            }
        }
        cache.insert(
            cache_key,
            PreviewCacheEntry {
                mtime_ms,
                max_w: max_width,
                max_h: max_height,
                quality,
                data_url: data_url.clone(),
            },
        );
    }

    Ok(data_url)
}

/// 缩放后返回 JPEG data URL，避免长截图整图 base64 卡死前端
#[tauri::command]
async fn read_image_preview_data_url(
    path: String,
    max_width: Option<u32>,
    max_height: Option<u32>,
    quality: Option<u8>,
) -> Result<String, String> {
    let max_w = max_width.unwrap_or(1200).min(2048).max(64);
    let max_h = max_height.unwrap_or(2400).min(4096).max(64);
    let q = quality.unwrap_or(82).clamp(50, 95);
    tauri::async_runtime::spawn_blocking(move || {
        read_image_preview_sync(path, max_w, max_h, q)
    })
    .await
    .map_err(|e| format!("预览任务失败: {}", e))?
}

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp"];

fn is_image_file(path: &Path) -> bool {
    path.extension()
        .and_then(|v| v.to_str())
        .map(|ext| IMAGE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

#[tauri::command]
fn workspaces_subpath(subpath: String) -> Result<String, String> {
    let path = workspaces_root().join(subpath);
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn list_images_at_path(path: String) -> Result<Vec<MediaFile>, String> {
    let settings = get_settings()?;
    let target = resolve_path(&settings.workspace_root, &path);
    if !target.exists() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    if target.is_file() {
        if is_image_file(&target) {
            files.push(MediaFile {
                name: target
                    .file_name()
                    .and_then(|v| v.to_str())
                    .unwrap_or("")
                    .to_string(),
                path: target.to_string_lossy().into_owned(),
            });
        }
        return Ok(files);
    }

    let entries =
        fs::read_dir(&target).map_err(|e| format!("读取目录失败: {} ({})", target.display(), e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let file_path = entry.path();
        if !file_path.is_file() || !is_image_file(&file_path) {
            continue;
        }
        files.push(MediaFile {
            name: file_path
                .file_name()
                .and_then(|v| v.to_str())
                .unwrap_or("")
                .to_string(),
            path: file_path.to_string_lossy().into_owned(),
        });
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

#[tauri::command]
fn list_child_dirs(path: String) -> Result<Vec<String>, String> {
    let settings = get_settings()?;
    let dir = resolve_path(&settings.workspace_root, &path);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut names = Vec::new();
    let entries =
        fs::read_dir(&dir).map_err(|e| format!("读取目录失败: {} ({})", dir.display(), e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        if entry.path().is_dir() {
            if let Some(name) = entry.file_name().to_str() {
                names.push(name.to_string());
            }
        }
    }
    names.sort();
    Ok(names)
}

#[tauri::command]
fn list_media_files(relative_dir: String) -> Result<Vec<MediaFile>, String> {
    let settings = get_settings()?;
    let dir = resolve_path(&settings.workspace_root, &relative_dir);
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let entries =
        fs::read_dir(&dir).map_err(|e| format!("读取目录失败: {} ({})", dir.display(), e))?;
    let mut files = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !IMAGE_EXTENSIONS.contains(&ext.as_str()) {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("")
            .to_string();
        files.push(MediaFile {
            name,
            path: path.to_string_lossy().to_string(),
        });
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(files)
}

#[tauri::command]
fn pick_folder() -> Option<String> {
    FileDialog::new()
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_image_file() -> Option<String> {
    FileDialog::new()
        .add_filter("Image", &["png", "jpg", "jpeg", "webp", "bmp"])
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

/// 系统文件对话框多选（Ctrl/Shift），返回绝对路径列表
#[tauri::command]
fn pick_image_files() -> Vec<String> {
    FileDialog::new()
        .add_filter("Image", &["png", "jpg", "jpeg", "webp", "bmp"])
        .pick_files()
        .map(|paths| {
            paths
                .into_iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default()
}

/// 字符画创意背景：图片、GIF 或短视频（WebView 可解码的格式）
#[tauri::command]
fn pick_ascii_media_file() -> Option<String> {
    FileDialog::new()
        .add_filter(
            "图片 / GIF / 视频",
            &["png", "jpg", "jpeg", "webp", "bmp", "gif", "mp4", "webm", "mov", "m4v"],
        )
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn write_workspaces_file(subpath: String, content: String) -> Result<(), String> {
    let path = workspaces_root().join(&subpath);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("创建目录失败: {} ({})", parent.display(), e))?;
    }
    fs::write(&path, content)
        .map_err(|e| format!("写入文件失败: {} ({})", path.display(), e))
}

#[tauri::command]
fn pick_text_file() -> Option<String> {
    FileDialog::new()
        .add_filter("Text", &["txt"])
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn detect_image_regions(image_path: String, device: Option<String>) -> Result<Vec<OcrRegion>, String> {
    let settings = get_settings()?;
    let script = region_ocr_script_path();
    if !script.exists() {
        return Err(format!("未找到区域识别脚本: {}", script.display()));
    }

    let image = resolve_path(&settings.workspace_root, &image_path);
    if !image.exists() {
        return Err(format!("图片不存在: {}", image.display()));
    }

    let python = resolve_python_for_ocr(&settings, Some("venv"))?;
    let mut cmd = Command::new(&python);
    apply_python_utf8_env(&mut cmd);
    let output = cmd
        .arg(script)
        .arg("--mode")
        .arg("detect")
        .arg("--image")
        .arg(image)
        .arg("--workspace-root")
        .arg(&settings.workspace_root)
        .arg("--device")
        .arg(device.unwrap_or_else(|| String::from("auto")))
        .output()
        .map_err(|e| format!("执行 detect_image_regions 失败: {}", e))?;

    if !output.status.success() {
        return Err(format_subprocess_error(&output.stderr, &output.stdout));
    }

    let text = String::from_utf8(output.stdout).map_err(|e| format!("读取 OCR 输出失败: {}", e))?;
    serde_json::from_str::<Vec<OcrRegion>>(&text)
        .map_err(|e| format!("解析检测结果失败: {} ({})", e, text))
}

#[tauri::command]
fn recognize_regions(
    image_path: String,
    boxes: Vec<RegionBoxInput>,
    device: Option<String>,
) -> Result<Vec<RegionRecognizeResult>, String> {
    let settings = get_settings()?;
    let script = region_ocr_script_path();
    if !script.exists() {
        return Err(format!("未找到区域识别脚本: {}", script.display()));
    }

    let image = resolve_path(&settings.workspace_root, &image_path);
    if !image.exists() {
        return Err(format!("图片不存在: {}", image.display()));
    }

    let boxes_json =
        serde_json::to_string(&boxes).map_err(|e| format!("序列化 boxes 失败: {}", e))?;
    let python = resolve_python_for_ocr(&settings, Some("venv"))?;
    let mut cmd = Command::new(&python);
    apply_python_utf8_env(&mut cmd);
    let output = cmd
        .arg(script)
        .arg("--mode")
        .arg("recognize")
        .arg("--image")
        .arg(image)
        .arg("--workspace-root")
        .arg(&settings.workspace_root)
        .arg("--boxes-json")
        .arg(boxes_json)
        .arg("--device")
        .arg(device.unwrap_or_else(|| String::from("auto")))
        .output()
        .map_err(|e| format!("执行 recognize_regions 失败: {}", e))?;

    if !output.status.success() {
        return Err(format_subprocess_error(&output.stderr, &output.stdout));
    }

    let text = String::from_utf8(output.stdout).map_err(|e| format!("读取 OCR 输出失败: {}", e))?;
    serde_json::from_str::<Vec<RegionRecognizeResult>>(&text)
        .map_err(|e| format!("解析重识别结果失败: {} ({})", e, text))
}

/// Windows：整窗透明度（透视桌面）。非 Windows 下为空操作。
#[tauri::command]
fn set_window_desktop_peek(
    window: tauri::WebviewWindow,
    enabled: bool,
    opacity_percent: u8,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::{COLORREF, HWND};
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetLayeredWindowAttributes, SetWindowLongPtrW, GWL_EXSTYLE,
            LWA_ALPHA, WS_EX_LAYERED,
        };

        let hwnd = window
            .hwnd()
            .map_err(|e| format!("获取窗口句柄失败: {e}"))?;
        let hwnd = HWND(hwnd.0 as *mut _);

        unsafe {
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | WS_EX_LAYERED.0 as isize);

            let alpha = if enabled {
                opacity_percent.clamp(60, 255)
            } else {
                255u8
            };

            SetLayeredWindowAttributes(hwnd, COLORREF(0), alpha, LWA_ALPHA)
                .map_err(|e| format!("设置窗口透明度失败: {e}"))?;
        }
        return Ok(());
    }

    #[cfg(not(windows))]
    {
        let _ = (window, enabled, opacity_percent);
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            list_plugins,
            run_tool,
            cancel_run,
            read_workspace_file,
            write_workspace_file,
            read_text_file,
            read_image_as_data_url,
            read_image_preview_data_url,
            list_media_files,
            list_images_at_path,
            list_child_dirs,
            workspaces_subpath,
            pick_folder,
            pick_image_file,
            pick_image_files,
            pick_ascii_media_file,
            copy_file_to_workspaces,
            write_workspaces_file,
            pick_text_file,
            detect_image_regions,
            recognize_regions,
            set_window_desktop_peek
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
