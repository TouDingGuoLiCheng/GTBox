use crate::focus::{self, TargetHwnd};
use crate::settings::SrSettings;

pub fn inject_text(settings: &SrSettings, target: TargetHwnd, text: &str) -> Result<(), String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("识别结果为空".to_string());
    }

    match settings.output_mode.as_str() {
        "clipboard" => write_clipboard(trimmed),
        "type" => type_unicode(target, trimmed),
        _ => paste_via_clipboard(settings, target, trimmed),
    }
}

fn write_clipboard(text: &str) -> Result<(), String> {
    arboard::Clipboard::new()
        .map_err(|e| format!("剪贴板不可用: {e}"))?
        .set_text(text)
        .map_err(|e| format!("写入剪贴板失败: {e}"))
}

fn paste_via_clipboard(
    settings: &SrSettings,
    target: TargetHwnd,
    text: &str,
) -> Result<(), String> {
    let backup = if settings.restore_clipboard {
        arboard::Clipboard::new()
            .ok()
            .and_then(|mut c| c.get_text().ok())
    } else {
        None
    };

    write_clipboard(text)?;

    if target.is_valid() {
        focus::focus_target(target)?;
        focus::send_paste()?;
    }

    if settings.restore_clipboard {
        if let Some(prev) = backup {
            let _ = arboard::Clipboard::new().and_then(|mut c| c.set_text(prev));
        }
    }
    Ok(())
}

fn type_unicode(target: TargetHwnd, text: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        if target.is_valid() {
            focus::focus_target(target)?;
        }
        use std::thread;
        use std::time::Duration;
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_UNICODE,
        };

        for ch in text.chars() {
            let code = ch as u16;
            let down = INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: Default::default(),
                        wScan: code,
                        dwFlags: KEYEVENTF_UNICODE,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            };
            let up = INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: Default::default(),
                        wScan: code,
                        dwFlags: KEYEVENTF_UNICODE | windows::Win32::UI::Input::KeyboardAndMouse::KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            };
            unsafe {
                SendInput(&[down], std::mem::size_of::<INPUT>() as i32);
                SendInput(&[up], std::mem::size_of::<INPUT>() as i32);
            }
            thread::sleep(Duration::from_millis(8));
        }
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        let _ = (target, text);
        Err("当前平台不支持模拟打字".to_string())
    }
}
