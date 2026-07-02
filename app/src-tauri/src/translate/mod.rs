pub mod app_data;
mod cache;
mod history;
mod http_translate;
mod providers;
pub mod settings;
mod target_lang;
mod text_encoding;
pub mod translator;
mod window_util;

use cache::TranslateCache;
use settings::TranslateSettings;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

pub struct TranslateState {
    pub settings: Mutex<TranslateSettings>,
    pub cache: Arc<TranslateCache>,
}

pub fn init_state() -> TranslateState {
    TranslateState {
        settings: Mutex::new(settings::load()),
        cache: Arc::new(TranslateCache::new()),
    }
}

pub fn setup(app: &tauri::App) -> Result<(), String> {
    providers::ensure_external_translators_config();
    let _ = app;
    Ok(())
}

#[tauri::command]
pub fn translate_get_settings(state: State<'_, TranslateState>) -> TranslateSettings {
    state
        .settings
        .lock()
        .map(|g| g.clone())
        .unwrap_or_default()
}

#[tauri::command]
pub fn translate_save_settings(
    app: AppHandle,
    state: State<'_, TranslateState>,
    settings: TranslateSettings,
) -> Result<(), String> {
    let settings = settings::normalize_settings(settings);
    settings::save(&settings)?;
    history::trim_to_limit(settings.history_max_count as usize);
    if let Ok(mut guard) = state.settings.lock() {
        *guard = settings.clone();
    }
    let _ = app.emit("translate:settings-updated", settings);
    Ok(())
}

#[tauri::command]
pub fn translate_text(
    app: AppHandle,
    state: State<'_, TranslateState>,
    text: String,
) -> Result<translator::TranslateResult, String> {
    let settings = state
        .settings
        .lock()
        .map(|g| g.clone())
        .map_err(|e| e.to_string())?;

    let result = translator::translate(&app, state.cache.as_ref(), &settings, &text);
    record_history_and_emit(&app, &text, &result, settings.history_max_count as usize);
    Ok(result)
}

fn record_history_and_emit(
    app: &AppHandle,
    source: &str,
    result: &translator::TranslateResult,
    max_records: usize,
) {
    history::append_from_translate(source, result, max_records);
    let _ = app.emit("translate:history-updated", history::list_records());
}

#[tauri::command]
pub fn translate_list_history() -> Vec<history::HistoryRecord> {
    history::list_records()
}

#[tauri::command]
pub fn translate_clear_history(app: AppHandle) -> Result<(), String> {
    history::clear_records()?;
    let _ = app.emit("translate:history-updated", Vec::<history::HistoryRecord>::new());
    Ok(())
}

#[tauri::command]
pub fn translate_delete_history(app: AppHandle, id: String) -> Result<(), String> {
    history::delete_record(&id)?;
    let _ = app.emit("translate:history-updated", history::list_records());
    Ok(())
}

#[tauri::command]
pub fn translate_list_providers() -> providers::TranslatorsFile {
    providers::load_translators()
}
