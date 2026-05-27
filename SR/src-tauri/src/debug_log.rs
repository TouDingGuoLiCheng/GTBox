use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

static LOG: OnceLock<Mutex<()>> = OnceLock::new();

pub fn log_path() -> PathBuf {
    crate::app_data::app_data_dir().join("sr-debug.log")
}

pub fn clear() -> Result<(), String> {
    let path = log_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(&path, "").map_err(|e| format!("清除日志失败: {e}"))?;
    info("debug log cleared");
    Ok(())
}

pub fn init_session(clear_existing: bool) {
    let path = log_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if clear_existing {
        let _ = fs::write(&path, "");
    }
    let header = format!(
        "\n========== SR session {} ==========\nlog: {}\n",
        now_ts(),
        path.display()
    );
    let _ = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut f| f.write_all(header.as_bytes()));
    info("debug log initialized");
}

fn lock() -> &'static Mutex<()> {
    LOG.get_or_init(|| Mutex::new(()))
}

fn now_ts() -> String {
    let d = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:03}", d.as_secs(), d.subsec_millis())
}

pub fn write(level: &str, msg: impl AsRef<str>) {
    let _guard = lock().lock().unwrap_or_else(|e| e.into_inner());
    let line = format!("[{}] [{}] {}\n", now_ts(), level, msg.as_ref());
    let _ = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path())
        .and_then(|mut f| f.write_all(line.as_bytes()));
    eprintln!("SR-DEBUG {level}: {}", msg.as_ref());
}

pub fn info(msg: impl AsRef<str>) {
    write("INFO", msg);
}

pub fn warn(msg: impl AsRef<str>) {
    write("WARN", msg);
}

pub fn error(msg: impl AsRef<str>) {
    write("ERROR", msg);
}

pub fn asr_event(ev: &crate::asr_daemon::AsrEvent) {
    write(
        "ASR",
        format!(
            "event={} session={:?} text={:?} code={:?} msg={:?}",
            ev.event,
            ev.session_id,
            ev.text,
            ev.code,
            ev.message
        ),
    );
}
