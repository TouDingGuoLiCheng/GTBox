use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FullTextOptions {
    pub normalize_line_endings: bool,
    #[serde(alias = "ignoreTrailingWhitespace")]
    pub ignore_all_whitespace: bool,
    pub ignore_final_newline: bool,
    pub ignore_bom: bool,
}

impl Default for FullTextOptions {
    fn default() -> Self {
        Self {
            normalize_line_endings: false,
            ignore_all_whitespace: false,
            ignore_final_newline: false,
            ignore_bom: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LineCompareOptions {
    pub trim_whitespace: bool,
    pub ignore_case: bool,
    pub ignore_order: bool,
    pub duplicate_mode: String,
}

impl Default for LineCompareOptions {
    fn default() -> Self {
        Self {
            trim_whitespace: false,
            ignore_case: false,
            ignore_order: true,
            duplicate_mode: "count".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RegexCompareOptions {
    pub match_scope: String,
    pub ignore_case: bool,
}

impl Default for RegexCompareOptions {
    fn default() -> Self {
        Self {
            match_scope: "line".into(),
            ignore_case: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TextCompareSettings {
    pub mode: String,
    pub full_text: FullTextOptions,
    pub line: LineCompareOptions,
    pub regex: RegexCompareOptions,
    #[serde(default)]
    pub rule_graph: Option<serde_json::Value>,
    #[serde(default)]
    pub legacy_regex: String,
    #[serde(default)]
    pub use_legacy_regex: bool,
}

impl Default for TextCompareSettings {
    fn default() -> Self {
        Self {
            mode: "line".into(),
            full_text: FullTextOptions::default(),
            line: LineCompareOptions::default(),
            regex: RegexCompareOptions::default(),
            rule_graph: None,
            legacy_regex: String::new(),
            use_legacy_regex: false,
        }
    }
}

fn settings_path() -> PathBuf {
    crate::translate::app_data::app_data_dir().join("text-compare.json")
}

#[tauri::command]
pub fn text_compare_get_settings() -> TextCompareSettings {
    let path = settings_path();
    if !path.exists() {
        return TextCompareSettings::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn text_compare_save_settings(settings: TextCompareSettings) -> Result<(), String> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    let p = PathBuf::from(path.trim());
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
        }
    }
    fs::write(&p, content).map_err(|e| format!("写入文件失败: {} ({e})", p.display()))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareProgressEvent {
    pub scanned: usize,
    pub total: usize,
    pub current_path: String,
    pub phase: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderDiffEntry {
    pub rel_path: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderCompareResult {
    #[serde(rename = "match")]
    pub is_match: bool,
    pub match_rate: u32,
    pub summary: String,
    pub same_file_count: usize,
    pub diff_file_count: usize,
    pub only_left_count: usize,
    pub only_right_count: usize,
    pub total_files: usize,
    pub missing_count: usize,
    pub extra_count: usize,
    pub diffs: Vec<FolderDiffEntry>,
}

fn emit_progress(app: &AppHandle, scanned: usize, total: usize, current_path: &str, phase: &str) {
    let _ = app.emit(
        "compare_progress",
        CompareProgressEvent {
            scanned,
            total,
            current_path: current_path.to_string(),
            phase: phase.to_string(),
        },
    );
}

fn normalize_rel(path: &Path, base: &Path) -> Result<String, String> {
    let rel = path
        .strip_prefix(base)
        .map_err(|_| format!("路径解析失败: {}", path.display()))?;
    Ok(rel.to_string_lossy().replace('\\', "/"))
}

fn walk_tree(
    root: &Path,
    base: &Path,
    dirs: &mut BTreeSet<String>,
    files: &mut BTreeMap<String, PathBuf>,
) -> Result<(), String> {
    if !root.is_dir() {
        return Err(format!("不是文件夹: {}", root.display()));
    }
    if root != base {
        dirs.insert(normalize_rel(root, base)?);
    }
    let entries = fs::read_dir(root)
        .map_err(|e| format!("读取目录失败: {} ({})", root.display(), e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let path = entry.path();
        if path.is_dir() {
            walk_tree(&path, base, dirs, files)?;
        } else if path.is_file() {
            let rel = normalize_rel(&path, base)?;
            files.insert(rel, path);
        }
    }
    Ok(())
}

fn files_equal(a: &Path, b: &Path) -> Result<bool, String> {
    let a_bytes = fs::read(a).map_err(|e| format!("读取文件失败: {} ({})", a.display(), e))?;
    let b_bytes = fs::read(b).map_err(|e| format!("读取文件失败: {} ({})", b.display(), e))?;
    Ok(a_bytes == b_bytes)
}

pub fn compare_folders_sync(
    app: &AppHandle,
    target: &str,
    candidate: &str,
) -> Result<FolderCompareResult, String> {
    let target_root = PathBuf::from(target.trim());
    let candidate_root = PathBuf::from(candidate.trim());
    if !target_root.is_dir() {
        return Err("目标文件夹不存在或不是目录".into());
    }
    if !candidate_root.is_dir() {
        return Err("待比对文件夹不存在或不是目录".into());
    }

    let mut target_dirs = BTreeSet::new();
    let mut target_files = BTreeMap::new();
    let mut candidate_dirs = BTreeSet::new();
    let mut candidate_files = BTreeMap::new();

    emit_progress(app, 0, 2, target, "scan");
    walk_tree(&target_root, &target_root, &mut target_dirs, &mut target_files)?;
    emit_progress(app, 1, 2, candidate, "scan");
    walk_tree(
        &candidate_root,
        &candidate_root,
        &mut candidate_dirs,
        &mut candidate_files,
    )?;

    let all_dirs: BTreeSet<_> = target_dirs.union(&candidate_dirs).cloned().collect();
    let all_files: BTreeSet<_> = target_files
        .keys()
        .chain(candidate_files.keys())
        .cloned()
        .collect();

    let total_steps = all_dirs.len() + all_files.len();
    let mut scanned = 0usize;
    let mut diffs = Vec::new();

    for dir in &target_dirs {
        if !candidate_dirs.contains(dir) {
            diffs.push(FolderDiffEntry {
                rel_path: format!("{dir}/"),
                kind: "only_left".into(),
            });
        }
        scanned += 1;
        emit_progress(app, scanned, total_steps, dir, "compare");
    }
    for dir in &candidate_dirs {
        if !target_dirs.contains(dir) {
            diffs.push(FolderDiffEntry {
                rel_path: format!("{dir}/"),
                kind: "only_right".into(),
            });
        }
    }

    let mut same_file_count = 0usize;
    let mut diff_file_count = 0usize;
    let mut only_left_count = 0usize;
    let mut only_right_count = 0usize;

    for rel in &all_files {
        scanned += 1;
        emit_progress(app, scanned.min(total_steps), total_steps, rel, "compare");

        let in_target = target_files.get(rel);
        let in_candidate = candidate_files.get(rel);

        match (in_target, in_candidate) {
            (Some(a), Some(b)) => {
                if files_equal(a, b)? {
                    same_file_count += 1;
                } else {
                    diff_file_count += 1;
                    diffs.push(FolderDiffEntry {
                        rel_path: rel.clone(),
                        kind: "content_diff".into(),
                    });
                }
            }
            (Some(_), None) => {
                only_left_count += 1;
                diffs.push(FolderDiffEntry {
                    rel_path: rel.clone(),
                    kind: "only_left".into(),
                });
            }
            (None, Some(_)) => {
                only_right_count += 1;
                diffs.push(FolderDiffEntry {
                    rel_path: rel.clone(),
                    kind: "only_right".into(),
                });
            }
            (None, None) => {}
        }
    }

    let only_left_dirs = diffs.iter().filter(|d| d.kind == "only_left" && d.rel_path.ends_with('/')).count();
    let only_right_dirs = diffs
        .iter()
        .filter(|d| d.kind == "only_right" && d.rel_path.ends_with('/'))
        .count();

    let missing_count = only_left_count + only_left_dirs + diff_file_count;
    let extra_count = only_right_count + only_right_dirs;
    let total_files = all_files.len();
    let is_match = diffs.is_empty();
    let match_rate = if total_files == 0 {
        if is_match { 100 } else { 0 }
    } else {
        ((same_file_count as f64 / total_files as f64) * 100.0).round() as u32
    };

    let summary = if is_match {
        format!("文件夹完全一致（{total_files} 个文件）")
    } else {
        format!(
            "不一致：内容不同 {diff_file_count}，仅目标 {only_left_count}，仅待比对 {only_right_count}"
        )
    };

    emit_progress(app, total_steps, total_steps, "", "done");

    Ok(FolderCompareResult {
        is_match,
        match_rate,
        summary,
        same_file_count,
        diff_file_count,
        only_left_count,
        only_right_count,
        total_files,
        missing_count,
        extra_count,
        diffs,
    })
}
