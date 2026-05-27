use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Deserialize)]
pub struct AsrEvent {
    pub event: String,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
    pub text: Option<String>,
    pub message: Option<String>,
    pub code: Option<String>,
    #[serde(rename = "modelDir")]
    pub model_dir: Option<String>,
}

pub struct AsrDaemon {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    events_rx: Receiver<AsrEvent>,
    reader_thread: Option<JoinHandle<()>>,
}

impl AsrDaemon {
    pub fn spawn(app: &AppHandle) -> Result<Self, String> {
        let script = streaming_script_path(app)?;
        let python = resolve_python(app)?;
        crate::debug_log::info(format!(
            "ASR spawn: python={python} script={}",
            script.display()
        ));

        let mut child = Command::new(&python);
        configure_hidden(&mut child);
        apply_python_env(&mut child, Path::new(&python));
        child
            .arg("-u")
            .arg(&script)
            .arg("--daemon")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = child
            .spawn()
            .map_err(|e| format!("无法启动 ASR 引擎: {e}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "ASR 引擎 stdin 不可用".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "ASR 引擎 stdout 不可用".to_string())?;
        let stderr = child.stderr.take();

        let (events_tx, events_rx) = mpsc::channel();
        let reader_thread = thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(line) => {
                        let line = line.trim();
                        if line.is_empty() {
                            continue;
                        }
                        match serde_json::from_str::<AsrEvent>(line) {
                            Ok(ev) => {
                                crate::debug_log::asr_event(&ev);
                                let _ = events_tx.send(ev);
                            }
                            Err(e) => {
                                crate::debug_log::warn(format!("ASR stdout parse fail: {e} | {line}"));
                            }
                        }
                    }
                    Err(e) => {
                        crate::debug_log::warn(format!("ASR stdout closed: {e}"));
                        break;
                    }
                }
            }
            crate::debug_log::info("ASR stdout reader exited");
        });

        if let Some(stderr) = stderr {
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    match line {
                        Ok(line) if !line.trim().is_empty() => {
                            crate::debug_log::write("ASR-PY", line.trim());
                        }
                        Err(e) => {
                            crate::debug_log::warn(format!("ASR stderr closed: {e}"));
                            break;
                        }
                        _ => {}
                    }
                }
            });
        }

        let daemon = Self {
            child,
            stdin: Arc::new(Mutex::new(stdin)),
            events_rx,
            reader_thread: Some(reader_thread),
        };

        let deadline = std::time::Instant::now() + Duration::from_secs(30);
        while std::time::Instant::now() < deadline {
            if let Some(ev) = daemon.try_recv_event() {
                match ev.event.as_str() {
                    "ready" => return Ok(daemon),
                    "error" => {
                        return Err(ev
                            .message
                            .or(ev.code)
                            .unwrap_or_else(|| "ASR 引擎启动失败".to_string()));
                    }
                    _ => {}
                }
            }
            thread::sleep(Duration::from_millis(50));
        }
        Err("ASR 引擎启动超时".to_string())
    }

    pub fn send_json(&self, value: serde_json::Value) -> Result<(), String> {
        let line = serde_json::to_string(&value).map_err(|e| e.to_string())?;
        let mut stdin = self.stdin.lock().map_err(|e| e.to_string())?;
        writeln!(stdin, "{line}").map_err(|e| format!("写入 ASR stdin 失败: {e}"))?;
        stdin.flush().map_err(|e| format!("flush ASR stdin 失败: {e}"))
    }

    pub fn load_model(&self, model_dir: &str) -> Result<(), String> {
        if model_dir.trim().is_empty() {
            return Err("请先配置模型目录".to_string());
        }
        let resolved = crate::model_path::resolve_for_sherpa(model_dir)?;
        crate::debug_log::info(format!(
            "ASR load_model: raw={model_dir} resolved={resolved}"
        ));
        self.send_json(serde_json::json!({
            "cmd": "load",
            "modelDir": resolved,
        }))?;
        let deadline = std::time::Instant::now() + Duration::from_secs(120);
        while std::time::Instant::now() < deadline {
            if let Ok(ev) = self.events_rx.try_recv() {
                match ev.event.as_str() {
                    "loaded" => {
                        crate::debug_log::info(format!(
                            "ASR model loaded: {:?}",
                            ev.model_dir
                        ));
                        return Ok(());
                    }
                    "error" => {
                        return Err(ev
                            .message
                            .or(ev.code)
                            .unwrap_or_else(|| "加载模型失败".to_string()));
                    }
                    _ => {}
                }
            }
            thread::sleep(Duration::from_millis(80));
        }
        Err("加载模型超时".to_string())
    }

    pub fn begin(&self, session_id: &str) -> Result<(), String> {
        crate::debug_log::info(format!("ASR begin session={session_id}"));
        self.send_json(serde_json::json!({
            "cmd": "begin",
            "sessionId": session_id,
            "sampleRate": 16000,
        }))
    }

    pub fn push_audio(&self, session_id: &str, samples: &[f32]) -> Result<(), String> {
        let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
        let encoded = STANDARD.encode(bytes);
        self.send_json(serde_json::json!({
            "cmd": "audio",
            "sessionId": session_id,
            "samples": encoded,
            "sampleCount": samples.len(),
        }))
    }

    pub fn end(&self, session_id: &str) -> Result<(), String> {
        crate::debug_log::info(format!("ASR end session={session_id}"));
        self.send_json(serde_json::json!({
            "cmd": "end",
            "sessionId": session_id,
        }))
    }

    pub fn try_recv_event(&self) -> Option<AsrEvent> {
        self.events_rx.try_recv().ok()
    }

    pub fn wait_final(&self, session_id: &str, timeout: Duration) -> Result<String, String> {
        let deadline = std::time::Instant::now() + timeout;
        let mut last_partial: Option<String> = None;
        loop {
            if let Some(ev) = self.try_recv_event() {
                if ev.session_id.as_deref() != Some(session_id) {
                    continue;
                }
                match ev.event.as_str() {
                    "partial" => {
                        if let Some(t) = ev.text.filter(|s| !s.trim().is_empty()) {
                            last_partial = Some(t);
                        }
                    }
                    "final" => {
                        return Ok(ev.text.unwrap_or_default());
                    }
                    "error" => {
                        return Err(ev
                            .message
                            .or(ev.code)
                            .unwrap_or_else(|| "识别失败".to_string()));
                    }
                    _ => {}
                }
            }
            if std::time::Instant::now() >= deadline {
                if let Some(t) = last_partial {
                    return Ok(t);
                }
                return Err("识别超时".to_string());
            }
            thread::sleep(Duration::from_millis(40));
        }
    }
}

impl Drop for AsrDaemon {
    fn drop(&mut self) {
        let _ = self.send_json(serde_json::json!({ "cmd": "shutdown" }));
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(handle) = self.reader_thread.take() {
            let _ = handle.join();
        }
    }
}

pub fn log_bundle_probe(app: &AppHandle) {
    crate::debug_log::info(format!("exe={:?}", std::env::current_exe().ok()));
    if let Ok(dir) = app.path().resource_dir() {
        crate::debug_log::info(format!("resource_dir={}", dir.display()));
    }
    for p in python_candidate_paths(app) {
        let ok = python_has_sherpa(&p);
        crate::debug_log::info(format!(
            "python candidate: {} exists={} sherpa={}",
            p.display(),
            p.is_file(),
            ok
        ));
    }
    for p in script_candidate_paths(app) {
        crate::debug_log::info(format!(
            "script candidate: {} exists={}",
            p.display(),
            p.is_file()
        ));
    }
}

#[cfg(windows)]
fn configure_hidden(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn configure_hidden(_cmd: &mut Command) {}

fn strip_verbatim_prefix(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path.to_path_buf()
    }
}

fn python_venv_root(py_exe: &Path) -> Option<PathBuf> {
    let py_exe = strip_verbatim_prefix(py_exe);
    let parent = py_exe.parent()?;
    if parent.file_name().and_then(|s| s.to_str()) == Some("Scripts") {
        parent.parent().map(|p| p.to_path_buf())
    } else {
        Some(parent.to_path_buf())
    }
}

fn python_site_packages(venv_root: &Path) -> PathBuf {
    venv_root.join("Lib").join("site-packages")
}

fn python_stdlib_zip(venv_root: &Path) -> Option<PathBuf> {
    let entries = std::fs::read_dir(venv_root).ok()?;
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let Some(name) = p.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if name.starts_with("python3") && name.ends_with(".zip") {
            return Some(p);
        }
    }
    None
}

fn python_path_env(venv_root: &Path) -> String {
    let mut parts = Vec::new();
    let scripts = venv_root.join("Scripts");
    let sp = python_site_packages(venv_root);
    parts.push(scripts.to_string_lossy().into_owned());
    parts.push(sp.to_string_lossy().into_owned());
    for sub in [
        "sherpa_onnx/lib",
        "sherpa_onnx",
        "onnxruntime/capi",
        "onnxruntime",
    ] {
        let p = sp.join(sub);
        if p.is_dir() {
            parts.push(p.to_string_lossy().into_owned());
        }
    }
    if let Ok(existing) = std::env::var("PATH") {
        parts.push(existing);
    }
    parts.join(";")
}

fn python_path_var(venv_root: &Path) -> String {
    let mut parts = Vec::new();
    if let Some(zip) = python_stdlib_zip(venv_root) {
        parts.push(zip.to_string_lossy().into_owned());
    }
    parts.push(venv_root.join("Lib").to_string_lossy().into_owned());
    parts.push(python_site_packages(venv_root).to_string_lossy().into_owned());
    parts.join(";")
}

fn apply_python_env(cmd: &mut Command, py_exe: &Path) {
    let py_exe = strip_verbatim_prefix(py_exe);
    if let Some(root) = python_venv_root(&py_exe) {
        cmd.env("PYTHONNOUSERSITE", "1");
        cmd.env("PYTHONHOME", root.to_string_lossy().to_string());
        cmd.env("PYTHONPATH", python_path_var(&root));
        cmd.env("PATH", python_path_env(&root));
    }
}

fn pyvenv_home_broken(home: &str) -> bool {
    let trimmed = home.trim();
    trimmed == "." || trimmed == "./" || trimmed == ".\\" || !Path::new(trimmed).join("python.exe").is_file()
}

/// Windows venv 的 Scripts/python.exe 会读取 pyvenv.cfg，并在 `{home}/python.exe` 启动解释器。
/// 打包时必须把 python.exe 复制到 venv 根目录；运行时把 home 改成本地绝对路径（联接目录优先）。
fn repair_pyvenv_cfg(runtime_root: &Path) {
    let runtime_root = strip_verbatim_prefix(runtime_root);
    let cfg_path = runtime_root.join("pyvenv.cfg");
    let root_py = runtime_root.join("python.exe");
    if !root_py.is_file() {
        crate::debug_log::warn(format!(
            "bundled python incomplete: missing {} (re-run npm run prepare:bundle)",
            root_py.display()
        ));
        return;
    }
    if !cfg_path.is_file() {
        crate::debug_log::warn(format!("missing pyvenv.cfg: {}", cfg_path.display()));
        return;
    }

    let canonical = strip_verbatim_prefix(
        &std::fs::canonicalize(&runtime_root).unwrap_or_else(|_| runtime_root.to_path_buf()),
    );
    let home_str = canonical.to_string_lossy();
    let exe_str = canonical
        .join("Scripts")
        .join("python.exe")
        .to_string_lossy()
        .into_owned();

    let content = match std::fs::read_to_string(&cfg_path) {
        Ok(c) => c,
        Err(e) => {
            crate::debug_log::warn(format!("read pyvenv.cfg failed: {e}"));
            return;
        }
    };

    let mut current_home = String::new();
    let mut version_line = String::from("version = 3.11.9");
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("home =") {
            current_home = rest.trim().to_string();
        } else if let Some(rest) = trimmed.strip_prefix("home=") {
            current_home = rest.trim().to_string();
        } else if trimmed.starts_with("version ") || trimmed.starts_with("version=") {
            version_line = trimmed.to_string();
        }
    }

    let target = format!(
        "home = {home_str}\ninclude-system-site-packages = false\n{version_line}\nexecutable = {exe_str}\n"
    );
    if !pyvenv_home_broken(&current_home) && current_home == home_str && content.trim() == target.trim() {
        return;
    }

    match std::fs::write(&cfg_path, &target) {
        Ok(()) => crate::debug_log::info(format!(
            "repaired pyvenv.cfg: home {} -> {home_str}",
            if current_home.is_empty() {
                "(missing)".to_string()
            } else {
                current_home
            }
        )),
        Err(e) => crate::debug_log::warn(format!("write pyvenv.cfg failed: {e}")),
    }
}

#[cfg(windows)]
fn python_link_cache_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(crate::app_data::app_data_dir)
        .join(crate::app_data::APP_DIR_NAME)
        .join("asr-python-links")
}

#[cfg(windows)]
fn ensure_ascii_python_junction(venv_root: &Path) -> Result<PathBuf, String> {
    let cache_root = python_link_cache_dir();
    std::fs::create_dir_all(&cache_root)
        .map_err(|e| format!("创建 Python 联接缓存目录失败: {e}"))?;

    let mut hasher = DefaultHasher::new();
    venv_root.hash(&mut hasher);
    let tag = format!("{:08x}", hasher.finish());
    let link_path = cache_root.join(format!("python-{tag}"));

    if link_path.is_dir() {
        if link_path.join("Scripts").join("python.exe").is_file() {
            return Ok(link_path);
        }
        std::fs::remove_dir(&link_path).map_err(|e| format!("清理旧 Python 联接失败: {e}"))?;
    }

    let status = Command::new("cmd")
        .args([
            "/C",
            "mklink",
            "/J",
            &link_path.to_string_lossy(),
            &venv_root.to_string_lossy(),
        ])
        .status()
        .map_err(|e| format!("创建 Python 目录联接失败: {e}"))?;

    if !status.success() {
        return Err(format!(
            "创建 Python 目录联接失败（{} → {}）",
            link_path.display(),
            venv_root.display()
        ));
    }
    Ok(link_path)
}

fn resolve_runtime_root(venv_root: &Path) -> PathBuf {
    let venv_root = strip_verbatim_prefix(venv_root);
    if venv_root.to_string_lossy().is_ascii() {
        return venv_root;
    }

    crate::debug_log::info(format!(
        "python path non-ascii, creating junction: {}",
        venv_root.display()
    ));

    #[cfg(windows)]
    {
        match ensure_ascii_python_junction(&venv_root) {
            Ok(link) => {
                crate::debug_log::info(format!("python junction ready: {}", link.display()));
                return link;
            }
            Err(e) => {
                crate::debug_log::warn(format!("python junction failed: {e}"));
            }
        }
    }

    venv_root
}

fn resolve_runnable_python(py: &Path) -> PathBuf {
    let py = strip_verbatim_prefix(py);
    if !py.is_file() {
        return py;
    }
    let Some(root) = python_venv_root(&py) else {
        return py;
    };
    let runtime_root = resolve_runtime_root(&root);
    repair_pyvenv_cfg(&runtime_root);
    let root_python = runtime_root.join("python.exe");
    if root_python.is_file() {
        return root_python;
    }
    runtime_root.join("Scripts").join("python.exe")
}

fn python_has_sherpa(py: &Path) -> bool {
    let py = resolve_runnable_python(py);
    if !py.is_file() {
        return false;
    }
    let mut cmd = Command::new(&py);
    configure_hidden(&mut cmd);
    apply_python_env(&mut cmd, &py);
    match cmd
        .arg("-c")
        .arg("import numpy, sherpa_onnx")
        .output()
    {
        Ok(o) if o.status.success() => true,
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr);
            let stdout = String::from_utf8_lossy(&o.stdout);
            crate::debug_log::warn(format!(
                "python sherpa check failed: {} | stderr={} stdout={}",
                py.display(),
                stderr.trim(),
                stdout.trim()
            ));
            false
        }
        Err(e) => {
            crate::debug_log::warn(format!("python spawn failed: {} | {e}", py.display()));
            false
        }
    }
}

fn resource_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        roots.push(dir);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            roots.push(parent.to_path_buf());
            roots.push(parent.join("resources"));
        }
    }
    #[cfg(debug_assertions)]
    {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        roots.push(manifest.join("resources"));
    }
    roots
}

fn python_candidate_paths(app: &AppHandle) -> Vec<PathBuf> {
    let rels = [
        "python/Scripts/python.exe",
        "python/python.exe",
        "Scripts/python.exe",
    ];
    let mut out = Vec::new();
    for root in resource_roots(app) {
        for rel in rels {
            out.push(root.join(rel));
        }
    }
    out
}

fn script_candidate_paths(app: &AppHandle) -> Vec<PathBuf> {
    let rels = [
        "streaming_asr.py",
        "resources/streaming_asr.py",
        "_up_/resources/streaming_asr.py",
    ];
    let mut out = Vec::new();
    if let Ok(p) = app.path().resolve("streaming_asr.py", tauri::path::BaseDirectory::Resource) {
        out.push(p);
    }
    for root in resource_roots(app) {
        for rel in rels {
            out.push(root.join(rel));
        }
    }
    out
}

fn resolve_python(app: &AppHandle) -> Result<String, String> {
    let mut tried = Vec::new();
    let mut found_exe = false;
    for p in python_candidate_paths(app) {
        tried.push(p.display().to_string());
        if p.is_file() {
            found_exe = true;
        }
        if python_has_sherpa(&p) {
            let runnable = resolve_runnable_python(&p);
            crate::debug_log::info(format!("ASR python (bundled): {}", runnable.display()));
            return Ok(runnable.to_string_lossy().into_owned());
        }
    }

    #[cfg(debug_assertions)]
    {
        for bin in ["python", "python3", "pythonw"] {
            let mut cmd = Command::new(bin);
            configure_hidden(&mut cmd);
            if cmd
                .arg("-c")
                .arg("import numpy, sherpa_onnx")
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
            {
                crate::debug_log::info(format!("ASR python (system dev): {bin}"));
                return Ok(bin.to_string());
            }
        }
    }

    let hint = if found_exe {
        "已找到 python.exe，但无法加载 sherpa-onnx（安装路径含中文时请查看 sr-debug.log；或重新执行 npm run prepare:bundle 打完整包）"
    } else {
        "未找到 python.exe，请重新执行完整 prepare:bundle 后打安装包"
    };
    Err(format!(
        "未找到内置 Python（sherpa-onnx）。{hint}。已检查: {}",
        tried.join(" | ")
    ))
}

fn streaming_script_path(app: &AppHandle) -> Result<PathBuf, String> {
    for p in script_candidate_paths(app) {
        if p.is_file() {
            return Ok(p);
        }
    }
    Err("找不到 streaming_asr.py（安装包资源缺失）".to_string())
}

pub fn copy_script_to_resources() {
    let src = crate::app_data::workspaces_sr_asr().join("streaming_asr.py");
    let dst = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/streaming_asr.py");
    if !src.is_file() {
        return;
    }
    if let Some(parent) = dst.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if script_needs_copy(&src, &dst) {
        let _ = std::fs::copy(&src, &dst);
    }
}

fn script_needs_copy(src: &Path, dst: &Path) -> bool {
    if !dst.is_file() {
        return true;
    }
    match (std::fs::read(src), std::fs::read(dst)) {
        (Ok(a), Ok(b)) => a != b,
        _ => true,
    }
}
