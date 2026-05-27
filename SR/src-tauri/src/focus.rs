use std::thread;
use std::time::Duration;

const FOCUS_SETTLE_MS: u64 = 80;
const KEY_GAP_MS: u64 = 12;

#[derive(Debug, Clone, Copy)]
pub struct TargetHwnd(pub isize);

impl TargetHwnd {
    pub fn is_valid(self) -> bool {
        self.0 != 0
    }
}

#[cfg(windows)]
pub fn capture_foreground_target() -> TargetHwnd {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    unsafe {
        TargetHwnd(GetForegroundWindow().0 as isize)
    }
}

#[cfg(not(windows))]
pub fn capture_foreground_target() -> TargetHwnd {
    TargetHwnd(0)
}

#[cfg(windows)]
pub fn focus_target(target: TargetHwnd) -> Result<(), String> {
    if !target.is_valid() {
        return Err("未找到目标窗口".to_string());
    }
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Input::KeyboardAndMouse::{keybd_event, KEYEVENTF_KEYUP, VK_MENU};
    use windows::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, SetForegroundWindow, ShowWindow, SW_SHOW,
    };

    let hwnd = HWND(target.0 as *mut _);
    unsafe {
        keybd_event(VK_MENU.0 as u8, 0, Default::default(), 0);
        keybd_event(VK_MENU.0 as u8, 0, KEYEVENTF_KEYUP, 0);
        let _ = ShowWindow(hwnd, SW_SHOW);
        let _ = BringWindowToTop(hwnd);
        SetForegroundWindow(hwnd)
            .ok()
            .map_err(|e| format!("无法激活目标窗口: {e}"))?;
    }
    thread::sleep(Duration::from_millis(FOCUS_SETTLE_MS));
    Ok(())
}

#[cfg(not(windows))]
pub fn focus_target(_target: TargetHwnd) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
pub fn send_paste() -> Result<(), String> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, VK_CONTROL, VK_V};

    let steps: &[(windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY, bool)] = &[
        (VK_CONTROL, false),
        (VK_V, false),
        (VK_V, true),
        (VK_CONTROL, true),
    ];
    for (vk, up) in steps {
        let input = key_event(*vk, *up);
        unsafe {
            let sent = SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
            if sent != 1 {
                return Err(format!("粘贴 SendInput 失败（{sent}/1）"));
            }
        }
        thread::sleep(Duration::from_millis(KEY_GAP_MS));
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn send_paste() -> Result<(), String> {
    Err("当前平台不支持模拟粘贴".to_string())
}

#[cfg(windows)]
fn key_event(
    vk: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY,
    key_up: bool,
) -> windows::Win32::UI::Input::KeyboardAndMouse::INPUT {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, INPUT, INPUT_0, INPUT_KEYBOARD,
    };

    let flags = if key_up {
        KEYEVENTF_KEYUP
    } else {
        KEYBD_EVENT_FLAGS::default()
    };

    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}
